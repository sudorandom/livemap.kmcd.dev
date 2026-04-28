use bgpkit_parser::models::Asn;
use bgpkit_parser::parse_ris_live_message;
use bgpkit_parser::parser::bmp::messages::BmpMessageBody;
use bgpkit_parser::{Elementor, parse_bmp_msg, parse_openbmp_header};
use bytes::Bytes;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use ipnet::IpNet;
use log::{debug, info, warn};
use parking_lot::RwLock;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message as WsMessage};

pub mod classifier;
pub mod db;
pub mod map;

pub mod rolling_windows;
pub mod stats;
use rolling_windows::*;
use stats::*;

use classifier::{ClassificationType, Classifier, DiskTrie, MessageContext, PendingEvent};
use db::{ClassificationStats, Db};
use map::Geolocation;

pub mod livemap_proto {
    tonic::include_proto!("livemap.v1");
}

use livemap_proto::live_map_service_server::{
    LiveMapService as LiveMap, LiveMapServiceServer as LiveMapServer,
};
use livemap_proto::{
    AggregatedEvent, Alert, AlertType, Classification as ProtoClassification, ClassificationCount,
    GeoData as ProtoGeoData, GetRecentAlertsRequest, GetRecentAlertsResponse, GetSummaryRequest,
    GetSummaryResponse, StateTransition, StreamAlertsRequest, StreamAlertsResponse,
    StreamPrefixSnapshotsRequest, StreamPrefixSnapshotsResponse, StreamStateTransitionsRequest,
    StreamStateTransitionsResponse, SubscribeEventsRequest, SubscribeEventsResponse,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, transport::Server};

const EXCLUDED_ASNS: &[u32] = &[749, 8003, 12654, 6447, 398324, 398722, 398705, 22168, 10439];

const BEACON_PREFIXES: &[&str] = &[
    "84.205.65.0/24",
    "84.205.81.0/24",
    "84.205.67.0/24",
    "84.205.64.0/24",
    "84.205.80.0/24",
    "84.205.69.0/24",
    "84.205.85.0/24",
    "84.205.70.0/24",
    "84.205.86.0/24",
    "84.205.75.0/24",
    "84.205.91.0/24",
    "84.205.82.0/24",
    "84.205.83.0/24",
    "84.205.76.0/24",
    "84.205.92.0/24",
    "84.205.88.0/24",
    "93.175.153.0/24",
    "93.175.152.0/24",
    "93.175.154.0/25",
    "93.175.154.128/28",
    "84.205.66.0/24",
    "93.175.146.0/24",
    "93.175.147.0/24",
];

fn map_classification(c: ClassificationType) -> ProtoClassification {
    match c {
        ClassificationType::None => ProtoClassification::Unspecified,
        ClassificationType::Bogon => ProtoClassification::Bogon,
        ClassificationType::Hijack => ProtoClassification::Hijack,
        ClassificationType::RouteLeak => ProtoClassification::RouteLeak,
        ClassificationType::Outage => ProtoClassification::Outage,
        ClassificationType::DDoSMitigation => ProtoClassification::DdosMitigation,
        ClassificationType::Flap => ProtoClassification::Flap,
        ClassificationType::PathHunting => ProtoClassification::PathHunting,
        ClassificationType::Discovery => ProtoClassification::Discovery,
        ClassificationType::MinorRouteLeak => ProtoClassification::MinorRouteLeak,
    }
}

#[derive(Serialize, Deserialize)]
struct Checkpoint {
    pub global_stats: StatsSnapshot,
    pub class_stats: HashMap<i32, StatsSnapshot>,
    pub timestamp: i64,
}

#[allow(clippy::type_complexity)]
struct AppState {
    subscribers: RwLock<Vec<mpsc::Sender<Result<SubscribeEventsResponse, Status>>>>,
    alert_subscribers: RwLock<Vec<mpsc::Sender<Result<StreamAlertsResponse, Status>>>>,
    transition_subscribers: RwLock<
        Vec<(
            mpsc::Sender<Result<StreamStateTransitionsResponse, Status>>,
            HashSet<ClassificationType>,
        )>,
    >,
    global_stats: CumulativeStats,
    ris_live_stats: CumulativeStats,
    routeviews_stats: CumulativeStats,
    beacon_stats: CumulativeStats,
    research_stats: CumulativeStats,
    class_stats: HashMap<ClassificationType, CumulativeStats>,
    input_tx: mpsc::Sender<(PendingEvent, bool)>,
    max_lag: AtomicU64,
    ingestion_start_ts: i64,
    cached_global_asn_count: AtomicU64,
    cached_global_prefix_count: AtomicU64,
    cached_global_ipv4_prefix_count: AtomicU64,
    cached_global_ipv6_prefix_count: AtomicU64,
    cached_global_ipv4_count: AtomicU64,
    cached_class_db_stats: RwLock<HashMap<ClassificationType, ClassificationStats>>,
    cached_class_ipv4_counts: RwLock<HashMap<ClassificationType, u64>>,
    loading_historical: AtomicBool,

    top_flappiest_networks: RwLock<Vec<livemap_proto::FlappiestNetworkStats>>,
    top_largest_org_name: RwLock<String>,
    top_largest_org_ipv4_count: AtomicU64,
    top_rpki_valid_ipv4: AtomicU64,
    top_rpki_invalid_ipv4: AtomicU64,
    top_rpki_not_found_ipv4: AtomicU64,
    top_rpki_valid_ipv6: AtomicU64,
    top_rpki_invalid_ipv6: AtomicU64,
    top_rpki_not_found_ipv6: AtomicU64,
}

struct LiveMapService {
    state: Arc<AppState>,
    classifier: Arc<Classifier>,
}

#[tonic::async_trait]
impl LiveMap for LiveMapService {
    type SubscribeEventsStream = ReceiverStream<Result<SubscribeEventsResponse, Status>>;
    type StreamStateTransitionsStream =
        ReceiverStream<Result<StreamStateTransitionsResponse, Status>>;

    type StreamAlertsStream = ReceiverStream<Result<StreamAlertsResponse, Status>>;
    type StreamPrefixSnapshotsStream =
        ReceiverStream<Result<StreamPrefixSnapshotsResponse, Status>>;
    async fn stream_prefix_snapshots(
        &self,
        _req: Request<StreamPrefixSnapshotsRequest>,
    ) -> Result<Response<Self::StreamPrefixSnapshotsStream>, Status> {
        let (tx, rx) = mpsc::channel(16);
        let classifier = self.classifier.clone();
        tokio::spawn(async move {
            const BATCH_SIZE: usize = 500;
            for shard in &classifier.shards {
                let snapshots: Vec<livemap_proto::PrefixSnapshot> = {
                    let guard = shard.lock();
                    guard
                        .iter()
                        .filter(|(_, state)| state.classified_type != ClassificationType::None)
                        .map(|(prefix, state)| {
                            let total_events: u32 =
                                state.buckets.values().map(|b| b.total_messages).sum();
                            livemap_proto::PrefixSnapshot {
                                prefix: prefix.clone(),
                                classification: map_classification(state.classified_type).into(),
                                asn: state.last_origin_asn,
                                last_update_ts: state.last_update_ts,
                                total_events,
                            }
                        })
                        .collect()
                };
                for chunk in snapshots.chunks(BATCH_SIZE) {
                    if tx
                        .send(Ok(StreamPrefixSnapshotsResponse {
                            snapshots: chunk.to_vec(),
                        }))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            }
        });
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn stream_alerts(
        &self,
        _req: Request<StreamAlertsRequest>,
    ) -> Result<Response<Self::StreamAlertsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        self.state.alert_subscribers.write().push(tx);
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn subscribe_events(
        &self,
        _req: Request<SubscribeEventsRequest>,
    ) -> Result<Response<Self::SubscribeEventsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        self.state.subscribers.write().push(tx);
        Ok(Response::new(ReceiverStream::new(rx)))
    }
    async fn stream_state_transitions(
        &self,
        req: Request<StreamStateTransitionsRequest>,
    ) -> Result<Response<Self::StreamStateTransitionsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        let target_states: HashSet<ClassificationType> = req
            .into_inner()
            .target_states
            .into_iter()
            .filter_map(|v| {
                for i in 0..10 {
                    let ct = ClassificationType::from_i32(i);
                    if map_classification(ct) as i32 == v {
                        return Some(ct);
                    }
                }
                None
            })
            .collect();
        self.state
            .transition_subscribers
            .write()
            .push((tx, target_states));
        Ok(Response::new(ReceiverStream::new(rx)))
    }
    async fn get_recent_alerts(
        &self,
        _req: Request<GetRecentAlertsRequest>,
    ) -> Result<Response<GetRecentAlertsResponse>, Status> {
        let alerts = self
            .classifier
            .state_db
            .as_ref()
            .map(|db: &Arc<Db>| db.get_recent_alerts())
            .unwrap_or_default();
        Ok(Response::new(GetRecentAlertsResponse { alerts }))
    }

    async fn get_summary(
        &self,
        _req: Request<GetSummaryRequest>,
    ) -> Result<Response<GetSummaryResponse>, Status> {
        let now = Utc::now().timestamp();
        let start_ts = self.state.ingestion_start_ts;
        let db_stats = self.state.cached_class_db_stats.read();
        let ipv4_counts = self.state.cached_class_ipv4_counts.read();
        let mut classification_counts = Vec::new();
        let indices = [1, 2, 3, 4, 5, 6, 8, 9];
        for i in indices {
            let k = ClassificationType::from_i32(i);
            let mut rate = 0.0;
            let mut window_count = 0;
            let mut total_count = 0;
            if let Some(s) = self.state.class_stats.get(&k) {
                rate = s.get_current_rate(now, start_ts);
                window_count = s
                    .rate_buckets
                    .iter()
                    .map(|b| b.load(Ordering::Relaxed))
                    .sum::<u64>() as u32;
                total_count = s.msg_count.load(Ordering::Relaxed);
            }
            let lookup_key = if k == ClassificationType::Discovery {
                ClassificationType::None
            } else {
                k
            };
            let (p_count, a_count, v4_p_count, v6_p_count) = match db_stats.get(&lookup_key) {
                Some(st) => (
                    st.total_prefixes,
                    st.asn_count,
                    st.ipv4_prefixes,
                    st.ipv6_prefixes,
                ),
                None => (0, 0, 0, 0),
            };
            let mut final_ipv4_count = ipv4_counts.get(&lookup_key).cloned().unwrap_or(0);
            if final_ipv4_count == 0 {
                // Approximate fallback for the first 10 minutes until the heavy IP aggregation runs
                final_ipv4_count = v4_p_count as u64 * 256;
            }
            classification_counts.push(ClassificationCount {
                classification: map_classification(k).into(),
                count: window_count,
                messages_per_second: rate,
                asn_count: a_count,
                prefix_count: p_count,
                ipv4_prefix_count: v4_p_count,
                ipv6_prefix_count: v6_p_count,
                ipv4_count: final_ipv4_count,
                total_count,
            });
        }
        let largest_org_name = self.state.top_largest_org_name.read().clone();
        let largest_org_ipv4_count = self
            .state
            .top_largest_org_ipv4_count
            .load(Ordering::Relaxed);

        Ok(Response::new(GetSummaryResponse {
            messages_per_second: self.state.global_stats.get_current_rate(now, start_ts),
            asn_count: self.state.cached_global_asn_count.load(Ordering::Relaxed) as u32,
            prefix_count: self
                .state
                .cached_global_prefix_count
                .load(Ordering::Relaxed) as u32,
            classification_counts,
            ipv4_prefix_count: self
                .state
                .cached_global_ipv4_prefix_count
                .load(Ordering::Relaxed) as u32,
            ipv6_prefix_count: self
                .state
                .cached_global_ipv6_prefix_count
                .load(Ordering::Relaxed) as u32,
            ipv4_count: self.state.cached_global_ipv4_count.load(Ordering::Relaxed),
            input_channel_len: 200000 - self.state.input_tx.capacity() as u32,
            input_channel_capacity: 200000,
            max_lag_seconds: self.state.max_lag.load(Ordering::Relaxed) as u32,
            loading_historical: self.state.loading_historical.load(Ordering::Relaxed),
            event_composition: Vec::new(),
            last_rpki_status: 0,
            flappiest_network_stats: self.state.top_flappiest_networks.read().clone(),
            largest_org_name,
            largest_org_ipv4_count,
            rpki_valid_ipv4: self.state.top_rpki_valid_ipv4.load(Ordering::Relaxed),
            rpki_invalid_ipv4: self.state.top_rpki_invalid_ipv4.load(Ordering::Relaxed),
            rpki_not_found_ipv4: self.state.top_rpki_not_found_ipv4.load(Ordering::Relaxed),
            rpki_valid_ipv6: self.state.top_rpki_valid_ipv6.load(Ordering::Relaxed),
            rpki_invalid_ipv6: self.state.top_rpki_invalid_ipv6.load(Ordering::Relaxed),
            rpki_not_found_ipv6: self.state.top_rpki_not_found_ipv6.load(Ordering::Relaxed),
        }))
    }
}

async fn process_ris_live_message(
    text: String,
    classifier: Arc<Classifier>,
    geo: Arc<Geolocation>,
    tx: mpsc::Sender<(PendingEvent, bool)>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let _ = tokio::task::spawn_blocking(move || {
        let bgp_msg = match parse_ris_live_message(&text) {
            Ok(msg) => msg,
            Err(_) => {
                return;
            }
        };
        let now = Utc::now().timestamp();
        for elem in bgp_msg {
            let path_str = elem
                .as_path
                .as_ref()
                .map(|p| p.to_string())
                .unwrap_or_default();
            let mut origin_asn = elem
                .origin_asns
                .as_ref()
                .and_then(|v| v.first())
                .map(|asn: &Asn| u32::from(*asn))
                .unwrap_or_default();
            if origin_asn == 0
                && let Some(last_asn) = path_str.split_whitespace().last()
                && let Ok(asn) = last_asn.parse::<u32>()
            {
                origin_asn = asn;
            }
            let net = IpNet::from_str(&elem.prefix.to_string()).ok();
            let mut geo_data = None;
            if let Some(n) = net {
                geo_data = geo.lookup(n.addr());
            }
            if geo_data.is_none() {
                geo_data = geo.lookup(elem.peer_ip);
            }
            let (lat, lon, city, country) = match geo_data {
                Some(gd) => (gd.lat, gd.lon, gd.city, gd.country),
                None => (0.0, 0.0, None, None),
            };
            let ctx = MessageContext {
                now,
                host: elem.peer_ip.to_string(),
                peer: elem.peer_ip.to_string(),
                is_withdrawal: elem.elem_type == bgpkit_parser::models::ElemType::WITHDRAW,
                path_str: path_str.clone(),
                comm_str: elem
                    .communities
                    .as_ref()
                    .map(|c| {
                        c.iter()
                            .map(|v| v.to_string())
                            .collect::<Vec<String>>()
                            .join(" ")
                    })
                    .unwrap_or_default(),
                origin_asn,
                path_len: elem
                    .as_path
                    .as_ref()
                    .map(|p| {
                        p.segments
                            .iter()
                            .map(|s| match s {
                                bgpkit_parser::models::AsPathSegment::AsSet(asns) => asns.len(),
                                bgpkit_parser::models::AsPathSegment::AsSequence(asns) => {
                                    asns.len()
                                }
                                bgpkit_parser::models::AsPathSegment::ConfedSequence(asns) => {
                                    asns.len()
                                }
                                bgpkit_parser::models::AsPathSegment::ConfedSet(asns) => asns.len(),
                            })
                            .sum()
                    })
                    .unwrap_or(0),
                source: "ris".to_string(),
            };
            let (event_opt, needs_timer) = classifier.classify_event(
                elem.prefix.to_string(),
                &ctx,
                lat,
                lon,
                city.clone(),
                country.clone(),
            );
            let is_classified = event_opt.is_some();
            let pending = event_opt.unwrap_or_else(|| PendingEvent {
                prefix: elem.prefix.to_string(),
                asn: origin_asn,
                as_name: String::new(),
                peer_ip: elem.peer_ip.to_string(),
                historical_asn: 0,
                timestamp: now,
                classification_type: ClassificationType::None,
                old_classification: ClassificationType::None,
                incident_id: None,
                incident_start_time: 0,
                leak_detail: None,
                anomaly_details: None,
                source: "ris".to_string(),
                lat,
                lon,
                city,
                country,
            });
            let _ = tx.blocking_send((pending, is_classified));

            if needs_timer {
                let p = elem.prefix.to_string();
                let c = classifier.clone();
                let t = tx.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    let check_now = Utc::now().timestamp();
                    if let Some(event) = c.check_outage(&p, check_now) {
                        let _ = t.send((event, true)).await;
                    }
                });
            }
        }
    })
    .await;
    Ok(())
}

async fn consume_ris_live(
    classifier: Arc<Classifier>,
    geo: Arc<Geolocation>,
    tx: mpsc::Sender<(PendingEvent, bool)>,
    subscription: String,
) {
    let mut backoff = Duration::from_secs(1);
    loop {
        debug!("Connecting to RIS Live...");
        if let Ok((mut socket, _)) = connect_async("ws://ris-live.ripe.net/v1/ws/").await {
            backoff = Duration::from_secs(1);
            if socket
                .send(WsMessage::Text(subscription.clone().into()))
                .await
                .is_err()
            {
                continue;
            }
            info!("Subscribed to RIS Live with: {}", subscription);
            let sem = Arc::new(tokio::sync::Semaphore::new(50));
            let (mut ws_tx, mut ws_rx) = socket.split();
            let mut hb = tokio::time::interval(Duration::from_secs(30));
            tokio::select! {
                _ = async { loop { hb.tick().await; if ws_tx.send(WsMessage::Ping(vec![].into())).await.is_err() { break; } } } => {}
                res = async {
                    while let Some(msg_res) = ws_rx.next().await {
                        match msg_res {
                            Ok(WsMessage::Text(text)) => {
                                let c = classifier.clone(); let t = tx.clone(); let s = sem.clone(); let g = geo.clone();
                                tokio::spawn(async move { let _p = s.acquire().await.ok(); let _ = process_ris_live_message(text.to_string(), c, g, t).await; });
                            }
                            Ok(_) => {},
                            Err(e) => return Err(e),
                        }
                    }
                    Ok::<(), tokio_tungstenite::tungstenite::Error>(())
                } => { if let Err(e) = res { warn!("RIS Live connection error: {}", e); } }
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(60));
    }
}

async fn process_routeviews_message(
    payload: Vec<u8>,
    classifier: Arc<Classifier>,
    geo: Arc<Geolocation>,
    tx: mpsc::Sender<(PendingEvent, bool)>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let _ = tokio::task::spawn_blocking(move || {
        let mut bytes = Bytes::copy_from_slice(&payload);
        let header = match parse_openbmp_header(&mut bytes) {
            Ok(h) => h,
            Err(_) => return,
        };
        let msg = match parse_bmp_msg(&mut bytes) {
            Ok(m) => m,
            Err(_) => return,
        };
        let now = Utc::now().timestamp();
        if let (Some(ph), BmpMessageBody::RouteMonitoring(rm)) =
            (msg.per_peer_header, msg.message_body)
        {
            for elem in
                Elementor::bgp_to_elems(rm.bgp_message, header.timestamp, &ph.peer_ip, &ph.peer_asn)
            {
                let path_str = elem
                    .as_path
                    .as_ref()
                    .map(|p| p.to_string())
                    .unwrap_or_default();
                let mut origin_asn = elem
                    .origin_asns
                    .as_ref()
                    .and_then(|v| v.first())
                    .map(|asn: &Asn| u32::from(*asn))
                    .unwrap_or_default();
                if origin_asn == 0
                    && let Some(last_asn) = path_str.split_whitespace().last()
                    && let Ok(asn) = last_asn.parse::<u32>()
                {
                    origin_asn = asn;
                }
                let net = IpNet::from_str(&elem.prefix.to_string()).ok();
                let mut geo_data = None;
                if let Some(n) = net {
                    geo_data = geo.lookup(n.addr());
                }
                if geo_data.is_none() {
                    geo_data = geo.lookup(elem.peer_ip);
                }
                let (lat, lon, city, country) = match geo_data {
                    Some(gd) => (gd.lat, gd.lon, gd.city, gd.country),
                    None => (0.0, 0.0, None, None),
                };
                let ctx = MessageContext {
                    now,
                    host: "routeviews".to_string(),
                    peer: elem.peer_ip.to_string(),
                    is_withdrawal: elem.elem_type == bgpkit_parser::models::ElemType::WITHDRAW,
                    path_str: path_str.clone(),
                    comm_str: elem
                        .communities
                        .as_ref()
                        .map(|c| {
                            c.iter()
                                .map(|v| v.to_string())
                                .collect::<Vec<String>>()
                                .join(" ")
                        })
                        .unwrap_or_default(),
                    origin_asn,
                    path_len: elem
                        .as_path
                        .as_ref()
                        .map(|p| {
                            p.segments
                                .iter()
                                .map(|s| match s {
                                    bgpkit_parser::models::AsPathSegment::AsSet(asns) => asns.len(),
                                    bgpkit_parser::models::AsPathSegment::AsSequence(asns) => {
                                        asns.len()
                                    }
                                    bgpkit_parser::models::AsPathSegment::ConfedSequence(asns) => {
                                        asns.len()
                                    }
                                    bgpkit_parser::models::AsPathSegment::ConfedSet(asns) => {
                                        asns.len()
                                    }
                                })
                                .sum()
                        })
                        .unwrap_or(0),
                    source: "routeviews".to_string(),
                };
                let (event_opt, needs_timer) = classifier.classify_event(
                    elem.prefix.to_string(),
                    &ctx,
                    lat,
                    lon,
                    city.clone(),
                    country.clone(),
                );
                let is_classified = event_opt.is_some();
                let pending = event_opt.unwrap_or_else(|| PendingEvent {
                    prefix: elem.prefix.to_string(),
                    asn: origin_asn,
                    as_name: String::new(),
                    peer_ip: "routeviews".to_string(),
                    historical_asn: 0,
                    timestamp: now,
                    classification_type: ClassificationType::None,
                    old_classification: ClassificationType::None,
                    incident_id: None,
                    incident_start_time: 0,
                    leak_detail: None,
                    anomaly_details: None,
                    source: "routeviews".to_string(),
                    lat,
                    lon,
                    city,
                    country,
                });
                let _ = tx.blocking_send((pending, is_classified));

                if needs_timer {
                    let p = elem.prefix.to_string();
                    let c = classifier.clone();
                    let t = tx.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_secs(10)).await;
                        let check_now = Utc::now().timestamp();
                        if let Some(event) = c.check_outage(&p, check_now) {
                            let _ = t.send((event, true)).await;
                        }
                    });
                }
            }
        }
    })
    .await;
    Ok(())
}

async fn consume_routeviews(
    classifier: Arc<Classifier>,
    geo: Arc<Geolocation>,
    tx: mpsc::Sender<(PendingEvent, bool)>,
) {
    let mut backoff = Duration::from_secs(5);
    let group_id = format!(
        "livemap-kmcd-dev-routeviews-{}",
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let pattern = "^routeviews\\..*\\..*\\.bmp_raw";

    loop {
        debug!("Connecting to RouteViews Kafka with group {}...", group_id);
        let res: Result<StreamConsumer, _> = ClientConfig::new()
            .set("bootstrap.servers", "stream.routeviews.org:9092")
            .set("group.id", &group_id)
            .set("auto.offset.reset", "latest")
            .set("session.timeout.ms", "60000")
            .set("heartbeat.interval.ms", "20000")
            .set("max.poll.interval.ms", "900000") // 15 minutes
            .set("enable.auto.commit", "true")
            .create();
        if let Ok(consumer) = res
            && consumer.subscribe(&[pattern]).is_ok()
        {
            info!(
                "Subscribed to RouteViews Kafka topics using pattern: {}",
                pattern
            );
            backoff = Duration::from_secs(5);
            let sem = Arc::new(tokio::sync::Semaphore::new(200));
            loop {
                match consumer.recv().await {
                    Ok(msg) => {
                        if let Some(p) = msg.payload() {
                            let p_owned = p.to_vec();
                            let c = classifier.clone();
                            let t = tx.clone();
                            let g = geo.clone();
                            let s = sem.clone();
                            tokio::spawn(async move {
                                let _p = s.acquire().await.ok();
                                let _ = process_routeviews_message(p_owned, c, g, t).await;
                            });
                        }
                    }
                    Err(e) => {
                        warn!("RouteViews Kafka receive error: {}. Reconnecting...", e);
                        break;
                    }
                }
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(300));
    }
}

use clap::Parser;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Paths to MMDB files for geolocation
    #[arg(short, long, required = true)]
    mmdb: Vec<String>,

    /// Listen address for the gRPC server
    #[arg(short, long, default_value = "127.0.0.1:50051")]
    listen: String,
}

fn entry_to_transition(e: &WindowEntry, class: ClassificationType) -> StateTransition {
    StateTransition {
        incident_id: String::new(), // incident_id is not stored in WindowEntry
        prefix: e.prefix.clone(),
        asn: e.asn,
        as_name: e.as_name.clone(),
        geo: Some(ProtoGeoData {
            lat: e.lat,
            lon: e.lon,
        }),
        city: e.city.clone().unwrap_or_default(),
        country: e.country.clone().unwrap_or_default(),
        new_state: map_classification(class).into(),
        old_state: map_classification(ClassificationType::None).into(),
        start_time: e.ts,
        end_time: e.ts,
        leak_detail: None,
        organization: e.org_name.clone().unwrap_or_default(),
        anomaly_details: String::new(),
        rpki_status: 0, // rpki_status is not stored in WindowEntry
    }
}

fn get_alert_key(alert: &Alert) -> String {
    let target = match AlertType::try_from(alert.alert_type) {
        Ok(AlertType::ByLocation) => {
            if let Some(loc) = &alert.location {
                format!("{:.1}:{:.1}", loc.lat, loc.lon)
            } else {
                "unknown".to_string()
            }
        }
        Ok(AlertType::ByAsn) => alert.asn.to_string(),
        Ok(AlertType::ByCountry) => alert.country.clone(),
        Ok(AlertType::ByOrganization) => alert.organization.clone(),
        _ => "unknown".to_string(),
    };
    // Use a 4-hour window for de-duplication
    let window = alert.timestamp / (4 * 3600);
    format!(
        "{}:{}:{}:{}",
        alert.alert_type, alert.classification, target, window
    )
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let start_instant = Instant::now();
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();
    info!("Starting server...");
    let sled_db = sled::open("db/sled").expect("Failed to open sled database");
    let seen_tree = sled_db.open_tree("seen").expect("Failed to open seen tree");
    let checkpoint_db = sled_db
        .open_tree("checkpoints")
        .expect("Failed to open checkpoints tree");
    let db = Arc::new(Db::new(
        "db/state.db",
        Some(DiskTrie::new(seen_tree.clone())),
    ));
    let db_for_classifier = db.clone();
    info!("Initializing classifier...");
    let classifier = Arc::new(Classifier::new(
        1000000,
        Some(DiskTrie::new(seen_tree)),
        Some(db_for_classifier),
    ));
    info!("Loading BGPKIT AS data in foreground...");
    let bgpkit = tokio::task::spawn_blocking(|| {
        let mut bgpkit = bgpkit_commons::BgpkitCommons::new();
        let start_asinfo = Instant::now();

        info!("Loading BGPKIT AS info using new_from_cached...");
        if let Err(e) = bgpkit.load_asinfo_cached() {
            warn!(
                "Failed to load BGPKIT AS info from cache: {}. Falling back to live download.",
                e
            );
            if let Err(live_e) = bgpkit.load_asinfo(true, true, true, true) {
                warn!("Failed to load fresh BGPKIT AS info: {}", live_e);
            } else {
                info!(
                    "Fresh BGPKIT AS info loaded (took {}s).",
                    start_asinfo.elapsed().as_secs()
                );
            }
        } else {
            info!(
                "BGPKIT AS info loaded from cache (took {}s).",
                start_asinfo.elapsed().as_secs()
            );
        }

        if let Err(e) = bgpkit.load_bogons() {
            warn!("Failed to load bogons: {}", e);
        }
        if let Err(e) = bgpkit.load_mrt_collectors() {
            warn!("Failed to load mrt collectors: {}", e);
        }

        bgpkit
    })
    .await?;

    // Assign to classifier
    {
        *classifier.bgpkit.write() = Some(bgpkit);
    }

    let classifier_bg = classifier.clone();
    let db_bg = db.clone();
    tokio::task::spawn_blocking(move || {
        info!("Loading BGPKIT RPKI data and AS2REL in background...");
        let start = Instant::now();

        let mut bgpkit = bgpkit_commons::BgpkitCommons::new();
        if let Err(e) = bgpkit.load_asinfo_cached() {
            warn!(
                "Failed to load BGPKIT AS info from cache in background: {}",
                e
            );
            let _ = bgpkit.load_asinfo(true, true, true, true);
        }
        let _ = bgpkit.load_bogons();
        let _ = bgpkit.load_mrt_collectors();

        info!(
            "Downloading and parsing RPKI data from Cloudflare... (This may take several minutes in debug mode without --release)"
        );
        if let Err(e) = bgpkit.load_rpki(None) {
            warn!("Failed to load BGPKIT RPKI data: {}", e);
        } else {
            info!("BGPKIT RPKI data loaded successfully.");
        }
        if let Err(e) = bgpkit.load_as2rel() {
            warn!("Failed to load as2rel: {}", e);
        }
        {
            *classifier_bg.bgpkit.write() = Some(bgpkit);
        }
        info!(
            "BGPKIT RPKI data and AS2REL loading complete (took {}s).",
            start.elapsed().as_secs()
        );

        // Background worker to keep metadata fresh
        let db_refresh = db_bg.clone();
        tokio::spawn(async move {
            // Wait for 10 minutes on startup to prioritize ingestion and stabilization
            info!("Background refresh manager will start in 10 minutes.");
            tokio::time::sleep(Duration::from_secs(600)).await;

            #[derive(Debug)]
            struct DatasetConfig {
                name: &'static str,
                refresh_interval: i64,
                retry_interval: i64,
            }

            let configs = vec![
                DatasetConfig {
                    name: "as_info",
                    refresh_interval: 7 * 86400,
                    retry_interval: 86400,
                }, // 7 days / 1 day retry
                DatasetConfig {
                    name: "rpki",
                    refresh_interval: 86400,
                    retry_interval: 3600,
                }, // 1 day / 1 hour retry
                DatasetConfig {
                    name: "bogons",
                    refresh_interval: 7 * 86400,
                    retry_interval: 86400,
                },
                DatasetConfig {
                    name: "as2rel",
                    refresh_interval: 7 * 86400,
                    retry_interval: 86400,
                },
                DatasetConfig {
                    name: "mrt",
                    refresh_interval: 30 * 86400,
                    retry_interval: 7 * 86400,
                },
            ];

            loop {
                let now_ts = Utc::now().timestamp();
                let mut anything_changed = false;

                // Load current global state for incremental updates
                // We maintain our own master copy in this thread to accumulate updates.
                static MASTER_BGPKIT: parking_lot::Mutex<Option<bgpkit_commons::BgpkitCommons>> =
                    parking_lot::Mutex::new(None);

                {
                    let mut master = MASTER_BGPKIT.lock();
                    if master.is_none() {
                        *master = Some(bgpkit_commons::BgpkitCommons::new());
                    }
                }

                for config in &configs {
                    let last_success = db_refresh.get_refresh_timestamp(config.name, "success");
                    let last_attempt = db_refresh.get_refresh_timestamp(config.name, "attempt");

                    let due_for_refresh = now_ts >= (last_success + config.refresh_interval);
                    let due_for_retry = (last_attempt > last_success)
                        && (now_ts >= (last_attempt + config.retry_interval));

                    if due_for_refresh || due_for_retry {
                        info!(
                            "[REFRESH] Dataset '{}' is due. Refresh={}, Retry={}",
                            config.name, due_for_refresh, due_for_retry
                        );
                        db_refresh.set_refresh_timestamp(config.name, "attempt", now_ts);

                        let name = config.name;
                        // Move the master instance into the blocking task to update it
                        let mut bgpkit_to_update = MASTER_BGPKIT.lock().take().unwrap();

                        let refresh_op = tokio::task::spawn_blocking(
                            move || -> anyhow::Result<bgpkit_commons::BgpkitCommons> {
                                match name {
                                    "as_info" => {
                                        bgpkit_to_update.load_asinfo(true, true, true, true)?
                                    }
                                    "rpki" => bgpkit_to_update.load_rpki(None)?,
                                    "bogons" => bgpkit_to_update.load_bogons()?,
                                    "as2rel" => bgpkit_to_update.load_as2rel()?,
                                    "mrt" => bgpkit_to_update.load_mrt_collectors()?,
                                    _ => return Err(anyhow::anyhow!("Unknown dataset")),
                                }
                                Ok(bgpkit_to_update)
                            },
                        )
                        .await;

                        match refresh_op {
                            Ok(Ok(updated_bgpkit)) => {
                                info!("[REFRESH] Successfully updated dataset: {}", config.name);
                                db_refresh.set_refresh_timestamp(config.name, "success", now_ts);
                                *MASTER_BGPKIT.lock() = Some(updated_bgpkit);
                                anything_changed = true;
                            }
                            Ok(Err(e)) => {
                                warn!(
                                    "[REFRESH] Failed to update dataset '{}': {}. Will retry in {} seconds.",
                                    config.name, e, config.retry_interval
                                );
                                // Put it back even on failure so we don't lose the other data
                                // We have to move it back, but wait, the closure consumed it.
                                // In the Err case, we don't have bgpkit_to_update anymore unless we return it.
                                // Actually, I'll just re-initialize it for now if it fails, or better,
                                // change the closure to return (BgpkitCommons, Result).
                                // For now, creating a new one is safe but lose some cached info.
                                *MASTER_BGPKIT.lock() = Some(bgpkit_commons::BgpkitCommons::new());
                            }
                            Err(e) => {
                                warn!(
                                    "[REFRESH] Background task panicked for dataset '{}': {}",
                                    config.name, e
                                );
                                *MASTER_BGPKIT.lock() = Some(bgpkit_commons::BgpkitCommons::new());
                            }
                        }
                    }
                }

                if anything_changed {
                    // We need to give a copy to the global state.
                    // Since it's not Clone, we'll move it in and create a new one for the background.
                    if let Some(mut c_bg) = classifier_bg.bgpkit.try_write() {
                        info!("Applying granular BGPKIT updates and clearing caches.");
                        let current_master = MASTER_BGPKIT.lock().take().unwrap();
                        *c_bg = Some(current_master);
                        classifier_bg.clear_cache();

                        // Background worker starts fresh for next cycle
                        *MASTER_BGPKIT.lock() = Some(bgpkit_commons::BgpkitCommons::new());
                    }
                }

                // Check again in 5 minutes
                tokio::time::sleep(Duration::from_secs(300)).await;
            }
        });
    });
    let (tx, mut rx) = mpsc::channel::<(PendingEvent, bool)>(200000);
    let geo = Arc::new(Geolocation::new(args.mmdb));
    let mut class_stats = HashMap::new();
    for i in [1, 2, 3, 4, 5, 6, 8, 9] {
        class_stats.insert(ClassificationType::from_i32(i), CumulativeStats::default());
    }
    let mut global_stats = CumulativeStats::default();
    if let Ok(Some(data)) = checkpoint_db.get("latest")
        && let Ok(cp) = serde_json::from_slice::<Checkpoint>(&data)
    {
        info!("Loaded checkpoint from DB (timestamp: {}).", cp.timestamp);
        global_stats = CumulativeStats::from_snapshot(cp.global_stats);
        for (k, v) in cp.class_stats {
            if let Some(s) = class_stats.get_mut(&ClassificationType::from_i32(k)) {
                *s = CumulativeStats::from_snapshot(v);
            }
        }
    }
    let (iv4v, iv4i, iv4n, iv6v, iv6i, iv6n) =
        db.get_cached_rpki_stats().unwrap_or((0, 0, 0, 0, 0, 0));

    let app_state = Arc::new(AppState {
        subscribers: RwLock::new(Vec::new()),
        alert_subscribers: RwLock::new(Vec::new()),
        transition_subscribers: RwLock::new(Vec::new()),
        global_stats,
        ris_live_stats: CumulativeStats::default(),
        routeviews_stats: CumulativeStats::default(),
        beacon_stats: CumulativeStats::default(),
        research_stats: CumulativeStats::default(),
        class_stats,
        input_tx: tx.clone(),
        max_lag: AtomicU64::new(0),
        ingestion_start_ts: Utc::now().timestamp(),
        cached_global_asn_count: AtomicU64::new(0),
        cached_global_prefix_count: AtomicU64::new(0),
        cached_global_ipv4_prefix_count: AtomicU64::new(0),
        cached_global_ipv6_prefix_count: AtomicU64::new(0),
        cached_global_ipv4_count: AtomicU64::new(0),
        cached_class_db_stats: RwLock::new(HashMap::new()),
        cached_class_ipv4_counts: RwLock::new(HashMap::new()),
        loading_historical: AtomicBool::new(true),

        top_flappiest_networks: RwLock::new(Vec::new()),
        top_largest_org_name: RwLock::new(String::new()),
        top_largest_org_ipv4_count: AtomicU64::new(0),
        top_rpki_valid_ipv4: AtomicU64::new(iv4v),
        top_rpki_invalid_ipv4: AtomicU64::new(iv4i),
        top_rpki_not_found_ipv4: AtomicU64::new(iv4n),
        top_rpki_valid_ipv6: AtomicU64::new(iv6v),
        top_rpki_invalid_ipv6: AtomicU64::new(iv6i),
        top_rpki_not_found_ipv6: AtomicU64::new(iv6n),
    });
    let c1 = classifier.clone();
    let g1 = geo.clone();
    let t1 = tx.clone();
    tokio::spawn(async move {
        consume_ris_live(
            c1,
            g1,
            t1,
            json!({"type": "ris_subscribe", "data": {"prefix": "0.0.0.0/0", "moreSpecific": true, "lessSpecific": true}})
                .to_string(),
        )
        .await;
    });
    let c1b = classifier.clone();
    let g1b = geo.clone();
    let t1b = tx.clone();
    tokio::spawn(async move {
        consume_ris_live(
            c1b,
            g1b,
            t1b,
            json!({"type": "ris_subscribe", "data": {"prefix": "::/0", "moreSpecific": true, "lessSpecific": true}})
                .to_string(),
        )
        .await;
    });
    let c2 = classifier.clone();
    let g2 = geo.clone();
    let t2 = tx.clone();
    tokio::spawn(async move {
        consume_routeviews(c2, g2, t2).await;
    });
    let s_log = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let now = Utc::now().timestamp();
            info!(
                "[INGEST] Total: {:.1} msg/s (RIS: {:.1}, RV: {:.1}) | Total: {} | Lag: {}s",
                s_log.global_stats.get_rate_for_window(now, 10),
                s_log.ris_live_stats.get_rate_for_window(now, 10),
                s_log.routeviews_stats.get_rate_for_window(now, 10),
                s_log.global_stats.msg_count.load(Ordering::Relaxed),
                s_log.max_lag.load(Ordering::Relaxed)
            );
        }
    });
    let s_stats = app_state.clone();
    let db_stats = db.clone();
    let c_stats = classifier.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let db_c = db_stats.clone();
            if let Ok((g, c, ts)) = tokio::task::spawn_blocking(move || {
                (
                    db_c.get_global_counts(),
                    db_c.get_classification_stats(),
                    db_c.get_top_stats(),
                )
            })
            .await
            {
                s_stats
                    .cached_global_asn_count
                    .store(g.asn_count as u64, Ordering::Relaxed);
                s_stats
                    .cached_global_prefix_count
                    .store(g.prefix_count as u64, Ordering::Relaxed);
                s_stats
                    .cached_global_ipv4_prefix_count
                    .store(g.ipv4_prefix_count as u64, Ordering::Relaxed);
                s_stats
                    .cached_global_ipv6_prefix_count
                    .store(g.ipv6_prefix_count as u64, Ordering::Relaxed);
                *s_stats.cached_class_db_stats.write() = c;

                let mut new_flappiest = Vec::new();
                for f in ts.flappiest_networks {
                    let mut network_name = String::new();
                    if let Some(bgpkit) = &*c_stats.bgpkit.read() {
                        if let Ok(Some(info)) = bgpkit.asinfo_get(f.asn) {
                            if let Some(org) = info.as2org {
                                network_name = org.org_name.clone();
                            } else if !info.name.is_empty() {
                                network_name = info.name.clone();
                            }
                        }
                    }
                    if network_name.is_empty() {
                        network_name = format!("AS{}", f.asn);
                    }
                    new_flappiest.push(livemap_proto::FlappiestNetworkStats {
                        asn: f.asn,
                        network_name,
                        event_rate: f.event_rate,
                        flap_count: f.flap_count,
                        prefix: f.prefix,
                    });
                }
                *s_stats.top_flappiest_networks.write() = new_flappiest;
            }
        }
    });
    let s_heavy = app_state.clone();
    let db_heavy = db.clone();
    let heavy_classifier = classifier.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // Initial delay to let RPKI data finish loading in the background
        tokio::time::sleep(Duration::from_secs(60)).await;

        loop {
            let pool = db_heavy.get_pool();
            info!("[STATS] Starting heavy IP aggregation...");

            let hc = heavy_classifier.clone();
            if let Ok(summary) = tokio::task::spawn_blocking(move || {
                let mut class_v4: HashMap<ClassificationType, Vec<ipnet::Ipv4Net>> = HashMap::new();
                let mut org_v4: HashMap<String, Vec<ipnet::Ipv4Net>> = HashMap::new();
                let mut global_v4 = Vec::new();

                let mut rpki_v4_valid = Vec::new();
                let mut rpki_v4_invalid = Vec::new();
                let mut rpki_v4_missing = Vec::new();

                let mut rpki_v6_valid = 0u64;
                let mut rpki_v6_invalid = 0u64;
                let mut rpki_v6_missing = 0u64;

                let mut count = 0;

                let guard = hc.bgpkit.read();
                let bgpkit_opt = guard.as_ref();
                let rpki_loaded = bgpkit_opt.is_some_and(|b| b.rpki_validate(0, "0.0.0.0/0").is_ok());

                if !rpki_loaded {
                    info!("[STATS] RPKI data is still loading... skipping RPKI aggregation for this cycle.");
                }

                if let Ok(conn) = pool.get()
                    && let Ok(mut stmt) =
                        conn.prepare("SELECT prefix, classified_type, origin_asn FROM prefix_state")
                {
                    let mut rows = stmt.query([]).unwrap();
                    // Per-loop local cache for heavy aggregation to avoid redundant lookups
                    let mut local_asinfo: HashMap<u32, (String, Option<String>)> = HashMap::new();

                    while let Ok(Some(row)) = rows.next() {
                        let p_str: String = row.get(0).unwrap();
                        let c_i32: i32 = row.get(1).unwrap();
                        let o_asn: u32 = row.get(2).unwrap_or(0);
                        let net_parsed = IpNet::from_str(&p_str).ok();
                        match net_parsed {
                            Some(IpNet::V4(v4)) => {
                                global_v4.push(v4);
                                class_v4
                                    .entry(ClassificationType::from_i32(c_i32))
                                    .or_default()
                                    .push(v4);

                                if o_asn > 0 {
                                    let (o_name, _) = local_asinfo
                                        .entry(o_asn)
                                        .or_insert_with(|| {
                                            let mut name = format!("AS{}", o_asn);
                                            let mut org = None;
                                            if let Some(bgpkit) = bgpkit_opt
                                                && let Ok(Some(info)) = bgpkit.asinfo_get(o_asn)
                                            {
                                                if let Some(o) = info.as2org {
                                                    name = o.org_name.clone();
                                                    org = Some(o.org_name);
                                                } else if !info.name.is_empty() {
                                                    name = info.name.clone();
                                                }
                                            }
                                            (name, org)
                                        })
                                        .clone();
                                    org_v4.entry(o_name).or_default().push(v4);

                                    // RPKI Check
                                    if rpki_loaded && let Some(bgpkit) = bgpkit_opt {
                                        let status = if let Ok(status) = bgpkit.rpki_validate(o_asn, &p_str) {
                                            match status {
                                                bgpkit_commons::rpki::RpkiValidation::Valid => 1,
                                                bgpkit_commons::rpki::RpkiValidation::Invalid => 2,
                                                bgpkit_commons::rpki::RpkiValidation::Unknown => 3,
                                            }
                                        } else {
                                            3
                                        };

                                        match status {
                                            1 => rpki_v4_valid.push(v4),
                                            2 => rpki_v4_invalid.push(v4),
                                            _ => rpki_v4_missing.push(v4),
                                        }
                                    }
                                } else if rpki_loaded {
                                    rpki_v4_missing.push(v4);
                                }
                                count += 1;
                            }
                            Some(IpNet::V6(_)) => {
                                if o_asn > 0 && rpki_loaded && let Some(bgpkit) = bgpkit_opt {
                                    let status = if let Ok(status) = bgpkit.rpki_validate(o_asn, &p_str) {
                                        match status {
                                            bgpkit_commons::rpki::RpkiValidation::Valid => 1,
                                            bgpkit_commons::rpki::RpkiValidation::Invalid => 2,
                                            bgpkit_commons::rpki::RpkiValidation::Unknown => 3,
                                        }
                                    } else {
                                        3
                                    };

                                    match status {
                                        1 => rpki_v6_valid += 1,
                                        2 => rpki_v6_invalid += 1,
                                        _ => rpki_v6_missing += 1,
                                    }
                                } else if rpki_loaded {
                                    rpki_v6_missing += 1;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                info!("[STATS] Aggregating {} IPv4 prefixes.", count);
                let g_ipv4 = if global_v4.is_empty() {
                    0
                } else {
                    ipnet::Ipv4Net::aggregate(&global_v4)
                        .iter()
                        .map(|n| {
                            if n.prefix_len() == 0 {
                                u32::MAX as u64 + 1
                            } else {
                                1u64 << (32 - n.prefix_len())
                            }
                        })
                        .sum::<u64>()
                };
                let mut c_ipv4 = HashMap::new();
                for (k, nets) in class_v4 {
                    c_ipv4.insert(
                        k,
                        ipnet::Ipv4Net::aggregate(&nets)
                            .iter()
                            .map(|n| {
                                if n.prefix_len() == 0 {
                                    u32::MAX as u64 + 1
                                } else {
                                    1u64 << (32 - n.prefix_len())
                                }
                            })
                            .sum::<u64>(),
                    );
                }

                let mut largest_org = String::new();
                let mut largest_org_ips = 0;
                for (org, nets) in org_v4 {
                    let ips = ipnet::Ipv4Net::aggregate(&nets)
                        .iter()
                        .map(|n| {
                            if n.prefix_len() == 0 {
                                u32::MAX as u64 + 1
                            } else {
                                1u64 << (32 - n.prefix_len())
                            }
                        })
                        .sum::<u64>();
                    if ips > largest_org_ips {
                        largest_org_ips = ips;
                        largest_org = org;
                    }
                }

                let sum_ips = |nets: &Vec<ipnet::Ipv4Net>| -> u64 {
                    if nets.is_empty() {
                        return 0;
                    }
                    ipnet::Ipv4Net::aggregate(nets)
                        .iter()
                        .map(|n| {
                            if n.prefix_len() == 0 {
                                u32::MAX as u64 + 1
                            } else {
                                1u64 << (32 - n.prefix_len())
                            }
                        })
                        .sum::<u64>()
                };

                let rv4 = sum_ips(&rpki_v4_valid);
                let ri4 = sum_ips(&rpki_v4_invalid);
                let rm4 = sum_ips(&rpki_v4_missing);

                (
                    g_ipv4,
                    c_ipv4,
                    largest_org,
                    largest_org_ips,
                    rv4,
                    ri4,
                    rm4,
                    rpki_v6_valid,
                    rpki_v6_invalid,
                    rpki_v6_missing,
                    rpki_loaded,
                )
            })
            .await
            {
                s_heavy
                    .cached_global_ipv4_count
                    .store(summary.0, Ordering::Relaxed);
                *s_heavy.cached_class_ipv4_counts.write() = summary.1;
                s_heavy.loading_historical.store(false, Ordering::Relaxed);

                *s_heavy.top_largest_org_name.write() = summary.2;
                s_heavy
                    .top_largest_org_ipv4_count
                    .store(summary.3, Ordering::Relaxed);

                let rpki_loaded = summary.10;
                if rpki_loaded {
                    s_heavy
                        .top_rpki_valid_ipv4
                        .store(summary.4, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_invalid_ipv4
                        .store(summary.5, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_not_found_ipv4
                        .store(summary.6, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_valid_ipv6
                        .store(summary.7, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_invalid_ipv6
                        .store(summary.8, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_not_found_ipv6
                        .store(summary.9, Ordering::Relaxed);

                    db_heavy.set_cached_rpki_stats(
                        summary.4, summary.5, summary.6, summary.7, summary.8, summary.9,
                    );
                } else if let Some((cv4v, cv4i, cv4n, cv6v, cv6i, cv6n)) =
                    db_heavy.get_cached_rpki_stats()
                {
                    // RPKI data is still loading; use cached values so the UI shows
                    // previously computed stats instead of zeros.
                    s_heavy
                        .top_rpki_valid_ipv4
                        .store(cv4v, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_invalid_ipv4
                        .store(cv4i, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_not_found_ipv4
                        .store(cv4n, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_valid_ipv6
                        .store(cv6v, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_invalid_ipv6
                        .store(cv6i, Ordering::Relaxed);
                    s_heavy
                        .top_rpki_not_found_ipv6
                        .store(cv6n, Ordering::Relaxed);
                }

                info!("[STATS] Refreshed heavy IP aggregation.");
            }
            interval.tick().await;
        }
    });
    let s_cp = app_state.clone();
    let db_cp = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
            db_cp.cleanup_old_data();
            let mut class_snaps = HashMap::new();
            for (k, v) in &s_cp.class_stats {
                class_snaps.insert(*k as i32, v.to_snapshot());
            }
            let cp = Checkpoint {
                global_stats: s_cp.global_stats.to_snapshot(),
                class_stats: class_snaps,
                timestamp: Utc::now().timestamp(),
            };
            if let Ok(data) = serde_json::to_vec(&cp) {
                let _ = checkpoint_db.insert("latest", data);
                let _ = checkpoint_db.flush();
            }
        }
    });
    let s_ingest = app_state.clone();
    let c_alert = classifier.clone();
    let rolling_windows = Arc::new(RwLock::new(RollingWindows::default()));
    let rw_ingest = rolling_windows.clone();
    let rw_alert = rolling_windows.clone();
    let s_alert = app_state.clone();

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        let mut emitted_alerts: HashMap<String, i64> = HashMap::new();
        loop {
            interval.tick().await;
            let now_tick = Utc::now().timestamp();
            let mut alerts;

            // To avoid holding the lock for a long time we yield frequently during cleanup,
            // or we clone just the parts we need, but for now we'll do the cleanup and clone
            // very quickly. But wait, if rolling windows is large, clone might be slow.
            // Let's spawn a blocking task to do the processing so it doesn't block the async executor thread.
            // Actually, we can just spawn blocking for the entire alert calculation block to not block the executor.

            let rw_cloned = {
                let mut rw = rw_alert.write();
                rw.cleanup(now_tick, 300); // 5 minutes window
                rw.clone()
            };
            let emitted_alerts_val = emitted_alerts.clone();
            alerts = match tokio::task::spawn_blocking(move || {
                let mut emitted_alerts_clone = emitted_alerts_val;
                let mut alerts = Vec::new();
                let rw = rw_cloned;
                emitted_alerts_clone.retain(|_, v| now_tick - *v < 3600); // 1 hour window

                // Check by Location
                for (&(lat_q, lon_q, class), v) in &rw.by_location {
                    let mut unique_prefixes = std::collections::HashSet::new();
                    let mut unique_asns = std::collections::HashSet::new();
                    let mut ipv4_count = 0u64;
                    let mut ipv6_prefixes = 0u32;
                    let mut city_counts = std::collections::HashMap::new();
                    let mut country_counts = std::collections::HashMap::new();

                    let mut count_recent = 0;
                    let mut recent_prefixes = std::collections::HashSet::new();
                    for e in v {
                        unique_asns.insert(e.asn);
                        if unique_prefixes.insert(e.prefix.clone())
                            && let Ok(net) = ipnet::IpNet::from_str(&e.prefix)
                        {
                            match net {
                                ipnet::IpNet::V4(v4) => {
                                    ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32)
                                }
                                ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                            }
                        }
                        if e.ts >= now_tick - 60 {
                            count_recent += 1;
                            recent_prefixes.insert(e.prefix.clone());
                        }
                        if let Some(ref c) = e.city {
                            *city_counts.entry(c.clone()).or_insert(0) += 1;
                        }
                        if let Some(ref c) = e.country {
                            *country_counts.entry(c.clone()).or_insert(0) += 1;
                        }
                    }
                    let count = v.len() as u32;
                    let count_old = v.len() as i32 - count_recent;
                    let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                    let delta = count_recent - avg_old;
                    let percentage_increase = if avg_old > 0 {
                        (delta as f32 / avg_old as f32) * 100.0
                    } else {
                        0.0
                    };
                    let mut anomaly_score = 0.0;
                    for p in &recent_prefixes {
                        if let Some(ph) = rw.prefix_stats.get(p) {
                            anomaly_score += ph.z_score(now_tick);
                        }
                    }
                    let top_city = city_counts
                        .into_iter()
                        .max_by_key(|&(_, c)| c)
                        .map(|(c, _)| c)
                        .unwrap_or_default();
                    let top_country = country_counts
                        .into_iter()
                        .max_by_key(|&(_, c)| c)
                        .map(|(c, _)| c)
                        .unwrap_or_default();

                    let alert_key = format!("loc:{}:{}:{}", lat_q, lon_q, top_country);
                    let last_emitted = emitted_alerts_clone.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 5000 || ipv6_prefixes >= 500)
                        && percentage_increase > 10.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts_clone.insert(alert_key, now_tick);
                        alerts.push(Alert {
                            alert_type: AlertType::ByLocation.into(),
                            location: Some(livemap_proto::AlertLocation {
                                city: top_city,
                                country: top_country,
                                lat: lat_q as f32 / 10.0,
                                lon: lon_q as f32 / 10.0,
                                radius_km: 11.0,
                            }),
                            asn: 0,
                            country: String::new(),
                            classification: map_classification(class).into(),
                            events_count: count,
                            delta,
                            timestamp: now_tick,
                            impacted_ipv4_ips: ipv4_count,
                            impacted_ipv6_prefixes: ipv6_prefixes,
                            percentage_increase,
                            as_name: String::new(),
                            organization: String::new(),
                            asn_count: unique_asns.len() as u32,
                            anomaly_score: anomaly_score as f32,
                            sample_events: v
                                .iter()
                                .rev()
                                .take(5)
                                .map(|e| entry_to_transition(e, class))
                                .collect(),
                        });
                    }
                }

                // Check by ASN
                for (&(asn, class), v) in &rw.by_asn {
                    let mut unique_prefixes = std::collections::HashSet::new();
                    let mut ipv4_count = 0u64;
                    let mut ipv6_prefixes = 0u32;
                    let mut as_name = String::new();
                    let mut city_counts = std::collections::HashMap::new();
                    let mut country_counts = std::collections::HashMap::new();
                    let (mut total_lat, mut total_lon, mut latlon_count) = (0.0, 0.0, 0);

                    let mut count_recent = 0;
                    let mut recent_prefixes = std::collections::HashSet::new();
                    for e in v {
                        if unique_prefixes.insert(e.prefix.clone())
                            && let Ok(net) = ipnet::IpNet::from_str(&e.prefix)
                        {
                            match net {
                                ipnet::IpNet::V4(v4) => {
                                    ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32)
                                }
                                ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                            }
                        }
                        if e.ts >= now_tick - 60 {
                            count_recent += 1;
                            recent_prefixes.insert(e.prefix.clone());
                        }
                        if !e.as_name.is_empty() {
                            as_name = e.as_name.clone();
                        }
                        if let Some(ref c) = e.city {
                            *city_counts.entry(c.clone()).or_insert(0) += 1;
                        }
                        if let Some(ref c) = e.country {
                            *country_counts.entry(c.clone()).or_insert(0) += 1;
                        }
                        total_lat += e.lat;
                        total_lon += e.lon;
                        latlon_count += 1;
                    }
                    let count = v.len() as u32;
                    let count_old = v.len() as i32 - count_recent;
                    let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                    let delta = count_recent - avg_old;
                    let percentage_increase = if avg_old > 0 {
                        (delta as f32 / avg_old as f32) * 100.0
                    } else {
                        0.0
                    };
                    let mut anomaly_score = 0.0;
                    for p in &recent_prefixes {
                        if let Some(ph) = rw.prefix_stats.get(p) {
                            anomaly_score += ph.z_score(now_tick);
                        }
                    }
                    let top_city = city_counts
                        .into_iter()
                        .max_by_key(|&(_, c)| c)
                        .map(|(c, _)| c)
                        .unwrap_or_default();
                    let top_country = country_counts
                        .into_iter()
                        .max_by_key(|&(_, c)| c)
                        .map(|(c, _)| c)
                        .unwrap_or_default();

                    let alert_key = format!("asn:{}", asn);
                    let last_emitted = emitted_alerts_clone.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 5000 || ipv6_prefixes >= 500)
                        && percentage_increase > 0.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts_clone.insert(alert_key, now_tick);
                        alerts.push(Alert {
                            alert_type: AlertType::ByAsn.into(),
                            location: Some(livemap_proto::AlertLocation {
                                city: top_city,
                                country: top_country,
                                lat: if latlon_count > 0 {
                                    total_lat / latlon_count as f32
                                } else {
                                    0.0
                                },
                                lon: if latlon_count > 0 {
                                    total_lon / latlon_count as f32
                                } else {
                                    0.0
                                },
                                radius_km: 0.0,
                            }),
                            asn,
                            country: String::new(),
                            classification: map_classification(class).into(),
                            events_count: count,
                            delta,
                            timestamp: now_tick,
                            impacted_ipv4_ips: ipv4_count,
                            impacted_ipv6_prefixes: ipv6_prefixes,
                            percentage_increase,
                            as_name,
                            organization: String::new(),
                            asn_count: 1,
                            anomaly_score: anomaly_score as f32,
                            sample_events: v
                                .iter()
                                .rev()
                                .take(5)
                                .map(|e| entry_to_transition(e, class))
                                .collect(),
                        });
                    }
                }

                // Check by Country
                for ((country, class), v) in &rw.by_country {
                    let mut unique_prefixes = std::collections::HashSet::new();
                    let mut unique_asns = std::collections::HashSet::new();
                    let mut ipv4_count = 0u64;
                    let mut ipv6_prefixes = 0u32;
                    let mut city_counts = std::collections::HashMap::new();
                    let (mut total_lat, mut total_lon, mut latlon_count) = (0.0, 0.0, 0);

                    let mut count_recent = 0;
                    let mut recent_prefixes = std::collections::HashSet::new();
                    for e in v {
                        unique_asns.insert(e.asn);
                        if unique_prefixes.insert(e.prefix.clone())
                            && let Ok(net) = ipnet::IpNet::from_str(&e.prefix)
                        {
                            match net {
                                ipnet::IpNet::V4(v4) => {
                                    ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32)
                                }
                                ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                            }
                        }
                        if e.ts >= now_tick - 60 {
                            count_recent += 1;
                            recent_prefixes.insert(e.prefix.clone());
                        }
                        if let Some(ref c) = e.city {
                            *city_counts.entry(c.clone()).or_insert(0) += 1;
                        }
                        total_lat += e.lat;
                        total_lon += e.lon;
                        latlon_count += 1;
                    }
                    let count = v.len() as u32;
                    let count_old = v.len() as i32 - count_recent;
                    let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                    let delta = count_recent - avg_old;
                    let percentage_increase = if avg_old > 0 {
                        (delta as f32 / avg_old as f32) * 100.0
                    } else {
                        0.0
                    };
                    let mut anomaly_score = 0.0;
                    for p in &recent_prefixes {
                        if let Some(ph) = rw.prefix_stats.get(p) {
                            anomaly_score += ph.z_score(now_tick);
                        }
                    }
                    let top_city = city_counts
                        .into_iter()
                        .max_by_key(|&(_, c)| c)
                        .map(|(c, _)| c)
                        .unwrap_or_default();

                    let alert_key = format!("country:{}", country);
                    let last_emitted = emitted_alerts_clone.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 50000 || ipv6_prefixes >= 500)
                        && percentage_increase > 10.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts_clone.insert(alert_key, now_tick);
                        alerts.push(Alert {
                            alert_type: AlertType::ByCountry.into(),
                            location: Some(livemap_proto::AlertLocation {
                                city: top_city,
                                country: country.clone(),
                                lat: if latlon_count > 0 {
                                    total_lat / latlon_count as f32
                                } else {
                                    0.0
                                },
                                lon: if latlon_count > 0 {
                                    total_lon / latlon_count as f32
                                } else {
                                    0.0
                                },
                                radius_km: 0.0,
                            }),
                            asn: 0,
                            country: country.clone(),
                            classification: map_classification(*class).into(),
                            events_count: count,
                            delta,
                            timestamp: now_tick,
                            impacted_ipv4_ips: ipv4_count,
                            impacted_ipv6_prefixes: ipv6_prefixes,
                            percentage_increase,
                            as_name: String::new(),
                            organization: String::new(),
                            asn_count: unique_asns.len() as u32,
                            anomaly_score: anomaly_score as f32,
                            sample_events: v
                                .iter()
                                .rev()
                                .take(5)
                                .map(|e| entry_to_transition(e, *class))
                                .collect(),
                        });
                    }
                }

                // Check by Organization
                for ((org, class), v) in &rw.by_organization {
                    let mut unique_prefixes = std::collections::HashSet::new();
                    let mut unique_asns = std::collections::HashSet::new();
                    let mut ipv4_count = 0u64;
                    let mut ipv6_prefixes = 0u32;
                    let mut city_counts = std::collections::HashMap::new();
                    let mut country_counts = std::collections::HashMap::new();
                    let (mut total_lat, mut total_lon, mut latlon_count) = (0.0, 0.0, 0);

                    let mut count_recent = 0;
                    let mut recent_prefixes = std::collections::HashSet::new();
                    for e in v {
                        unique_asns.insert(e.asn);
                        if unique_prefixes.insert(e.prefix.clone())
                            && let Ok(net) = ipnet::IpNet::from_str(&e.prefix)
                        {
                            match net {
                                ipnet::IpNet::V4(v4) => {
                                    ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32)
                                }
                                ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                            }
                        }
                        if e.ts >= now_tick - 60 {
                            count_recent += 1;
                            recent_prefixes.insert(e.prefix.clone());
                        }
                        if let Some(ref c) = e.city {
                            *city_counts.entry(c.clone()).or_insert(0) += 1;
                        }
                        if let Some(ref c) = e.country {
                            *country_counts.entry(c.clone()).or_insert(0) += 1;
                        }
                        total_lat += e.lat;
                        total_lon += e.lon;
                        latlon_count += 1;
                    }
                    let count = v.len() as u32;
                    let count_old = v.len() as i32 - count_recent;
                    let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                    let delta = count_recent - avg_old;
                    let percentage_increase = if avg_old > 0 {
                        (delta as f32 / avg_old as f32) * 100.0
                    } else {
                        0.0
                    };
                    let mut anomaly_score = 0.0;
                    for p in &recent_prefixes {
                        if let Some(ph) = rw.prefix_stats.get(p) {
                            anomaly_score += ph.z_score(now_tick);
                        }
                    }
                    let top_city = city_counts
                        .into_iter()
                        .max_by_key(|&(_, c)| c)
                        .map(|(c, _)| c)
                        .unwrap_or_default();
                    let top_country = country_counts
                        .into_iter()
                        .max_by_key(|&(_, c)| c)
                        .map(|(c, _)| c)
                        .unwrap_or_default();

                    let alert_key = format!("org:{}", org);
                    let last_emitted = emitted_alerts_clone.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 20000 || ipv6_prefixes >= 500)
                        && percentage_increase > 0.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts_clone.insert(alert_key, now_tick);
                        alerts.push(Alert {
                            alert_type: AlertType::ByOrganization.into(),
                            location: Some(livemap_proto::AlertLocation {
                                city: top_city,
                                country: top_country,
                                lat: if latlon_count > 0 {
                                    total_lat / latlon_count as f32
                                } else {
                                    0.0
                                },
                                lon: if latlon_count > 0 {
                                    total_lon / latlon_count as f32
                                } else {
                                    0.0
                                },
                                radius_km: 0.0,
                            }),
                            asn: 0,
                            country: String::new(),
                            classification: map_classification(*class).into(),
                            events_count: count,
                            delta,
                            timestamp: now_tick,
                            impacted_ipv4_ips: ipv4_count,
                            impacted_ipv6_prefixes: ipv6_prefixes,
                            percentage_increase,
                            as_name: String::new(),
                            organization: org.clone(),
                            asn_count: unique_asns.len() as u32,
                            anomaly_score: anomaly_score as f32,
                            sample_events: v
                                .iter()
                                .rev()
                                .take(5)
                                .map(|e| entry_to_transition(e, *class))
                                .collect(),
                        });
                    }
                }

                (alerts, emitted_alerts_clone)
            })
            .await
            {
                Ok((res_alerts, new_emitted)) => {
                    emitted_alerts = new_emitted;
                    res_alerts
                }
                Err(_) => Vec::new(),
            };

            if !alerts.is_empty() {
                alerts.sort_by(|a, b| {
                    b.anomaly_score
                        .partial_cmp(&a.anomaly_score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                });

                let mut loc_count = 0;
                let mut asn_count = 0;
                let mut country_count = 0;
                let mut org_count = 0;

                let mut filtered_alerts = Vec::new();
                for alert in alerts {
                    match livemap_proto::AlertType::try_from(alert.alert_type).ok() {
                        None | Some(livemap_proto::AlertType::Unspecified) => {}
                        Some(livemap_proto::AlertType::ByLocation) => {
                            if loc_count < 2 {
                                filtered_alerts.push(alert);
                                loc_count += 1;
                            }
                        }
                        Some(livemap_proto::AlertType::ByAsn) => {
                            if asn_count < 2 {
                                filtered_alerts.push(alert);
                                asn_count += 1;
                            }
                        }
                        Some(livemap_proto::AlertType::ByCountry) => {
                            if country_count < 2 {
                                filtered_alerts.push(alert);
                                country_count += 1;
                            }
                        }
                        Some(livemap_proto::AlertType::ByOrganization) => {
                            if org_count < 2 {
                                filtered_alerts.push(alert);
                                org_count += 1;
                            }
                        }
                    }
                }

                if !filtered_alerts.is_empty() {
                    let mut alert_subs = s_alert.alert_subscribers.write();
                    if let Some(db) = &c_alert.state_db {
                        for alert in &filtered_alerts {
                            db.record_alert(get_alert_key(alert), alert.clone());
                        }
                    }
                    for alert in filtered_alerts {
                        alert_subs.retain(|sub| {
                            sub.try_send(Ok(StreamAlertsResponse {
                                alert: Some(alert.clone()),
                            }))
                            .is_ok()
                        });
                    }
                }
            }
        }
    });

    let beacon_nets: Vec<ipnet::IpNet> = BEACON_PREFIXES
        .iter()
        .filter_map(|s| ipnet::IpNet::from_str(s).ok())
        .collect();
    let research_set: HashSet<u32> = EXCLUDED_ASNS.iter().cloned().collect();
    let db_ingest = db.clone();
    let c_ingest = classifier.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        let mut aggregate_buffer: HashMap<AggregationKey, u32> = HashMap::new();
        let mut last_emitted_transitions: HashMap<String, i64> = HashMap::new();
        loop {
            tokio::select! {
                Some(first_msg) = rx.recv() => {
                    let now = Utc::now().timestamp(); let mut batched = vec![first_msg];
                    while let Ok(msg) = rx.try_recv() { batched.push(msg); if batched.len() >= 5000 { break; } }
                    let mut max_lag = 0;
                    let mut transitions = Vec::new();
                    let mut rw_updates = Vec::new();

                    // Per-batch local cache to avoid redundant lookups and Mutex contention
                    let mut local_as_names: HashMap<u32, String> = HashMap::new();
                    let mut local_as_orgs: HashMap<u32, Option<String>> = HashMap::new();

                    for (pending, _) in batched {
                        let lag = now - pending.timestamp;
                        if lag > max_lag {
                            max_lag = lag;
                        }
                        s_ingest.global_stats.add_event(now);
                        if pending.source == "ris" {
                            s_ingest.ris_live_stats.add_event(now);
                        } else if pending.source == "routeviews" {
                            s_ingest.routeviews_stats.add_event(now);
                        }
                        if let Some(cs) = s_ingest.class_stats.get(&pending.classification_type) {
                            cs.add_event(now);
                        }

                        if pending.classification_type == ClassificationType::Flap {
                            db_ingest.record_event(
                                &pending.prefix,
                                pending.asn,
                                ClassificationType::Flap as i32,
                                now,
                            );
                        }

                        let mut is_beacon = false;
                        if let Ok(net) = ipnet::IpNet::from_str(&pending.prefix) {
                            for bnet in &beacon_nets {
                                if bnet.contains(&net.network()) || net.contains(&bnet.network()) {
                                    is_beacon = true;
                                    break;
                                }
                            }
                        }
                        if is_beacon {
                            s_ingest.beacon_stats.add_event(now);
                        } else if research_set.contains(&pending.asn) {
                            s_ingest.research_stats.add_event(now);
                        }
                        let key = AggregationKey {
                            lat_q: (pending.lat * 10.0) as i32,
                            lon_q: (pending.lon * 10.0) as i32,
                            classification: pending.classification_type,
                        };
                        *aggregate_buffer.entry(key).or_insert(0) += 1;

                        if matches!(
                            pending.classification_type,
                            ClassificationType::RouteLeak
                                | ClassificationType::MinorRouteLeak
                                | ClassificationType::Hijack
                                | ClassificationType::Outage
                        ) {
                            let org = local_as_orgs
                                .entry(pending.asn)
                                .or_insert_with(|| c_ingest.get_as_org(pending.asn))
                                .clone();
                            rw_updates.push((
                                pending.lat,
                                pending.lon,
                                pending.asn,
                                pending.as_name.clone(),
                                org,
                                pending.country.clone(),
                                pending.city.clone(),
                                pending.classification_type,
                                now,
                                pending.prefix.clone(),
                            ));
                        }
                        if pending.classification_type != pending.old_classification
                            && let Some(id) = &pending.incident_id
                        {
                            let transition_key = format!("{}:{}", pending.prefix, pending.asn);
                            let last_emitted = last_emitted_transitions
                                .get(&transition_key)
                                .copied()
                                .unwrap_or(0);
                            if now - last_emitted >= 300 {
                                last_emitted_transitions.insert(transition_key, now);
                                let cur_as_name = local_as_names
                                    .entry(pending.asn)
                                    .or_insert_with(|| {
                                        c_ingest.get_as_name(pending.asn).unwrap_or_default()
                                    })
                                    .clone();
                                transitions.push(StateTransition {
                                    incident_id: id.clone(),
                                    prefix: pending.prefix.clone(),
                                    asn: pending.asn,
                                    as_name: cur_as_name,
                                    geo: Some(ProtoGeoData {
                                        lat: pending.lat,
                                        lon: pending.lon,
                                    }),
                                    city: pending.city.clone().unwrap_or_default(),
                                    country: pending.country.clone().unwrap_or_default(),
                                    new_state: map_classification(pending.classification_type)
                                        .into(),
                                    old_state: map_classification(pending.old_classification)
                                        .into(),
                                    start_time: pending.incident_start_time,
                                    end_time: if pending.classification_type
                                        == ClassificationType::None
                                    {
                                        now
                                    } else {
                                        0
                                    },
                                    leak_detail: pending.leak_detail.as_ref().map(|ld| {
                                        let leaker_name = local_as_names
                                            .entry(ld.leaker_asn)
                                            .or_insert_with(|| {
                                                c_ingest
                                                    .get_as_name(ld.leaker_asn)
                                                    .unwrap_or_default()
                                            })
                                            .clone();
                                        let victim_name = local_as_names
                                            .entry(ld.victim_asn)
                                            .or_insert_with(|| {
                                                c_ingest
                                                    .get_as_name(ld.victim_asn)
                                                    .unwrap_or_default()
                                            })
                                            .clone();
                                        livemap_proto::LeakDetail {
                                            leak_type: ld.leak_type as u32,
                                            leaker_asn: ld.leaker_asn,
                                            victim_asn: ld.victim_asn,
                                            leaker_as_name: leaker_name,
                                            victim_as_name: victim_name,
                                            leaker_rpki_status: ld.leaker_rpki_status,
                                            victim_rpki_status: ld.victim_rpki_status,
                                        }
                                    }),
                                    organization: local_as_orgs
                                        .entry(pending.asn)
                                        .or_insert_with(|| c_ingest.get_as_org(pending.asn))
                                        .clone()
                                        .unwrap_or_default(),
                                    anomaly_details: pending
                                        .anomaly_details
                                        .as_ref()
                                        .map(|a| {
                                            serde_json::to_string(a).unwrap_or_default()
                                        })
                                        .unwrap_or_default(),
                                    rpki_status: 0,
                                });
                            }
                        }
                    }

                    if !rw_updates.is_empty() {
                        let mut rw = rw_ingest.write();
                        for u in rw_updates {
                            rw.add_event(
                                u.0, u.1, u.2, u.3, u.4, u.5, u.6, u.7, u.8, u.9,
                            );
                        }
                    }
                    s_ingest.max_lag.store(max_lag as u64, Ordering::Relaxed);
                    if !transitions.is_empty() {
                        let mut subs = s_ingest.transition_subscribers.write();
                        subs.retain(|(sub, target)| {
                            for t in &transitions {
                                let (c, old) = (ClassificationType::from_i32(t.new_state), ClassificationType::from_i32(t.old_state));
                                if (target.is_empty() || target.contains(&c) || target.contains(&old)) && sub.try_send(Ok(livemap_proto::StreamStateTransitionsResponse { transition: Some(t.clone()) })).is_err() { return false; }
                            }
                            true
                        });
                    }
                }
                _ = interval.tick() => {
                    let now_tick = Utc::now().timestamp();
                    last_emitted_transitions.retain(|_, v| now_tick - *v < 3600); // 1 hour window

                    if !aggregate_buffer.is_empty() {
                        let events = aggregate_buffer.drain().map(|(k, count)| AggregatedEvent {
                            geo: Some(ProtoGeoData {
                                lat: k.lat_q as f32 / 10.0,
                                lon: k.lon_q as f32 / 10.0
                            }),
                            classification: map_classification(k.classification).into(),
                            count
                        }).collect();
                        let resp = SubscribeEventsResponse { events }; let mut subs = s_ingest.subscribers.write();
                        subs.retain(|sub| sub.try_send(Ok(resp.clone())).is_ok());
                    }
                }
            }
        }
    });
    let addr = args.listen.parse().expect("Failed to parse listen address");
    info!("Starting gRPC server on {}", addr);
    info!("Startup took {}ms", start_instant.elapsed().as_millis());
    Server::builder()
        .add_service(LiveMapServer::new(LiveMapService {
            state: app_state,
            classifier: classifier.clone(),
        }))
        .serve(addr)
        .await?;
    Ok(())
}

#[cfg(test)]
mod rolling_windows_test;
#[cfg(test)]
mod stats_test;
