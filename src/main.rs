use bgpkit_parser::models::Asn;
use bgpkit_parser::parse_ris_live_message;
use bgpkit_parser::parser::bmp::messages::BmpMessageBody;
use bgpkit_parser::{Elementor, parse_bmp_msg, parse_openbmp_header};
use bytes::Bytes;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use ipnet::IpNet;
use log::{debug, info, warn};
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
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
    GeoData as ProtoGeoData, GetSummaryRequest, GetSummaryResponse, StateTransition,
    StreamAlertsRequest, StreamAlertsResponse, StreamStateTransitionsRequest,
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

    top_flappiest_asn: RwLock<String>,
    top_flappiest_network: RwLock<String>,
    top_flappy_prefix_count: AtomicU32,
    top_largest_org_name: RwLock<String>,
    top_largest_org_ipv4_count: AtomicU64,
    top_rpki_valid_ipv4: AtomicU64,
    top_rpki_invalid_ipv4: AtomicU64,
    top_rpki_not_found_ipv4: AtomicU64,
}

struct LiveMapService {
    state: Arc<AppState>,
}

#[tonic::async_trait]
impl LiveMap for LiveMapService {
    type SubscribeEventsStream = ReceiverStream<Result<SubscribeEventsResponse, Status>>;
    type StreamStateTransitionsStream =
        ReceiverStream<Result<StreamStateTransitionsResponse, Status>>;

    type StreamAlertsStream = ReceiverStream<Result<StreamAlertsResponse, Status>>;
    async fn stream_alerts(
        &self,
        _req: Request<StreamAlertsRequest>,
    ) -> Result<Response<Self::StreamAlertsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        self.state.alert_subscribers.write().await.push(tx);
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn subscribe_events(
        &self,
        _req: Request<SubscribeEventsRequest>,
    ) -> Result<Response<Self::SubscribeEventsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        self.state.subscribers.write().await.push(tx);
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
            .await
            .push((tx, target_states));
        Ok(Response::new(ReceiverStream::new(rx)))
    }
    async fn get_summary(
        &self,
        _req: Request<GetSummaryRequest>,
    ) -> Result<Response<GetSummaryResponse>, Status> {
        let now = Utc::now().timestamp();
        let start_ts = self.state.ingestion_start_ts;
        let db_stats = self.state.cached_class_db_stats.read().await;
        let ipv4_counts = self.state.cached_class_ipv4_counts.read().await;
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
        let flappiest_asn = self.state.top_flappiest_asn.read().await.clone();
        let flappiest_network = self.state.top_flappiest_network.read().await.clone();
        let flappy_prefix_count = self.state.top_flappy_prefix_count.load(Ordering::Relaxed);
        let largest_org_name = self.state.top_largest_org_name.read().await.clone();
        let largest_org_ipv4_count = self.state.top_largest_org_ipv4_count.load(Ordering::Relaxed);
        let rpki_valid_ipv4 = self.state.top_rpki_valid_ipv4.load(Ordering::Relaxed);
        let rpki_invalid_ipv4 = self.state.top_rpki_invalid_ipv4.load(Ordering::Relaxed);
        let rpki_not_found_ipv4 = self.state.top_rpki_not_found_ipv4.load(Ordering::Relaxed);

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
            flappiest_asn_str: flappiest_asn,
            flappiest_network,
            flappy_prefix_count,
            largest_org_name,
            largest_org_ipv4_count,
            rpki_valid_ipv4,
            rpki_invalid_ipv4,
            rpki_not_found_ipv4,
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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
    tokio::task::spawn_blocking(move || {
        info!("Loading BGPKIT RPKI data and AS2REL in background...");
        let start = Instant::now();
        let mut bgpkit = classifier_bg.bgpkit.write().take().unwrap_or_default();

        if let Err(e) = bgpkit.load_rpki(None) {
            warn!("Failed to load BGPKIT RPKI data: {}", e);
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

        // Background worker to keep asinfo fresh
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(86400)); // Every 24 hours
            interval.tick().await; // skip first
            loop {
                interval.tick().await;
                info!("Refreshing BGPKIT AS info in background...");
                let mut fresh_bgpkit = bgpkit_commons::BgpkitCommons::new();

                // Attempt fresh download for reload
                if let Err(e) = fresh_bgpkit.load_asinfo(true, true, true, true) {
                    warn!("Background refresh of BGPKIT AS info failed: {}", e);
                } else {
                    let _ = fresh_bgpkit.load_bogons();
                    let _ = fresh_bgpkit.load_as2rel();
                    let _ = fresh_bgpkit.load_mrt_collectors();
                    let _ = fresh_bgpkit.load_rpki(None);

                    if let Some(mut c_bg) = classifier_bg.bgpkit.try_write() {
                        info!("Applying fresh BGPKIT AS info.");
                        *c_bg = Some(fresh_bgpkit);
                    }
                }
            }
        });
    });
    let (tx, mut rx) = mpsc::channel::<(PendingEvent, bool)>(200000);
    let geo = Arc::new(Geolocation::new("assets/dbip-city-lite-2026-03.mmdb"));
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

        top_flappiest_asn: RwLock::new(String::new()),
        top_flappiest_network: RwLock::new(String::new()),
        top_flappy_prefix_count: AtomicU32::new(0),
        top_largest_org_name: RwLock::new(String::new()),
        top_largest_org_ipv4_count: AtomicU64::new(0),
        top_rpki_valid_ipv4: AtomicU64::new(0),
        top_rpki_invalid_ipv4: AtomicU64::new(0),
        top_rpki_not_found_ipv4: AtomicU64::new(0),
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
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let now = Utc::now().timestamp();
            info!(
                "[INGEST] Total: {:.1} msg/s (RIS: {:.1}, RV: {:.1}) | Total: {} | Lag: {}s",
                s_log.global_stats.get_rate_for_window(now, 5),
                s_log.ris_live_stats.get_rate_for_window(now, 5),
                s_log.routeviews_stats.get_rate_for_window(now, 5),
                s_log.global_stats.msg_count.load(Ordering::Relaxed),
                s_log.max_lag.load(Ordering::Relaxed)
            );
        }
    });
    let s_stats = app_state.clone();
    let db_stats = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let db_c = db_stats.clone();
            if let Ok((g, c, ts)) = tokio::task::spawn_blocking(move || {
                (db_c.get_global_counts(), db_c.get_classification_stats(), db_c.get_top_stats())
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
                *s_stats.cached_class_db_stats.write().await = c;

                if ts.flappiest_asn > 0 {
                    s_stats.top_flappy_prefix_count.store(ts.flappy_prefix_count, Ordering::Relaxed);
                    let mut flappiest_asn = format!("AS{}", ts.flappiest_asn);
                    let mut flappiest_org = String::new();

                    let bgpkit = bgpkit_commons::BgpkitCommons::new();
                    if let Ok(Some(info)) = bgpkit.asinfo_get(ts.flappiest_asn) {
                        if let Some(org) = info.as2org {
                            flappiest_asn = format!("AS{}", ts.flappiest_asn);
                            flappiest_org = org.org_name.clone();
                        }
                    }
                    *s_stats.top_flappiest_asn.write().await = flappiest_asn;
                    *s_stats.top_flappiest_network.write().await = flappiest_org;
                }
            }
        }
    });
    let s_heavy = app_state.clone();
    let db_heavy = db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let pool = db_heavy.get_pool();
            if let Ok(summary) = tokio::task::spawn_blocking(move || {
                let mut class_v4: HashMap<ClassificationType, Vec<ipnet::Ipv4Net>> = HashMap::new();
                let mut org_v4: HashMap<String, Vec<ipnet::Ipv4Net>> = HashMap::new();
                let mut global_v4 = Vec::new();

                let mut rpki_valid = Vec::new();
                let mut rpki_invalid = Vec::new();
                let mut rpki_missing = Vec::new();

                let mut count = 0;
                let bgpkit = bgpkit_commons::BgpkitCommons::new();
                if let Ok(conn) = pool.get()
                    && let Ok(mut stmt) =
                        conn.prepare("SELECT prefix, classified_type, origin_asn FROM prefix_state")
                {
                    let mut rows = stmt.query([]).unwrap();
                    while let Ok(Some(row)) = rows.next() {
                        let p_str: String = row.get(0).unwrap();
                        let c_i32: i32 = row.get(1).unwrap();
                        let o_asn: u32 = row.get(2).unwrap_or(0);
                        if let Ok(IpNet::V4(v4)) = IpNet::from_str(&p_str) {
                            global_v4.push(v4);
                            class_v4
                                .entry(ClassificationType::from_i32(c_i32))
                                .or_default()
                                .push(v4);

                            if o_asn > 0 {
                                let mut o_name = format!("AS{}", o_asn);
                                if let Ok(Some(info)) = bgpkit.asinfo_get(o_asn) {
                                    if let Some(org) = info.as2org {
                                        o_name = org.org_name.clone();
                                    }
                                }
                                org_v4.entry(o_name).or_default().push(v4);

                                // RPKI Check
                                if let Ok(status) = bgpkit.rpki_validate(o_asn, &p_str) {
                                    match status {
                                        bgpkit_commons::rpki::RpkiValidation::Valid => rpki_valid.push(v4),
                                        bgpkit_commons::rpki::RpkiValidation::Invalid => rpki_invalid.push(v4),
                                        bgpkit_commons::rpki::RpkiValidation::Unknown => rpki_missing.push(v4),
                                    }
                                } else {
                                    rpki_missing.push(v4);
                                }
                            } else {
                                rpki_missing.push(v4);
                            }

                            count += 1;
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

                let rv = sum_ips(&rpki_valid);
                let ri = sum_ips(&rpki_invalid);
                let rm = sum_ips(&rpki_missing);

                (g_ipv4, c_ipv4, largest_org, largest_org_ips, rv, ri, rm)
            })
            .await
            {
                s_heavy
                    .cached_global_ipv4_count
                    .store(summary.0, Ordering::Relaxed);
                *s_heavy.cached_class_ipv4_counts.write().await = summary.1;
                s_heavy.loading_historical.store(false, Ordering::Relaxed);

                *s_heavy.top_largest_org_name.write().await = summary.2;
                s_heavy.top_largest_org_ipv4_count.store(summary.3, Ordering::Relaxed);
                s_heavy.top_rpki_valid_ipv4.store(summary.4, Ordering::Relaxed);
                s_heavy.top_rpki_invalid_ipv4.store(summary.5, Ordering::Relaxed);
                s_heavy.top_rpki_not_found_ipv4.store(summary.6, Ordering::Relaxed);

                info!("[STATS] Refreshed heavy IP aggregation.");
            }
        }
    });
    let s_cp = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
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
    let c_ingest = classifier.clone();
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
            let mut alerts = Vec::new();
            let rw_cloned = {
                let mut rw = rw_alert.write().await;
                rw.cleanup(now_tick, 300); // 5 minutes window
                rw.clone()
            };
            {
                let rw = rw_cloned;
                emitted_alerts.retain(|_, v| now_tick - *v < 3600); // 1 hour window

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
                    let last_emitted = emitted_alerts.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 5000 || ipv6_prefixes >= 20)
                        && percentage_increase > 0.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts.insert(alert_key, now_tick);
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
                    let last_emitted = emitted_alerts.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 5000 || ipv6_prefixes >= 20)
                        && percentage_increase > 0.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts.insert(alert_key, now_tick);
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
                    let last_emitted = emitted_alerts.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 50000 || ipv6_prefixes >= 200)
                        && percentage_increase > 10.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts.insert(alert_key, now_tick);
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
                    let last_emitted = emitted_alerts.get(&alert_key).copied().unwrap_or(0);
                    if (ipv4_count >= 10000 || ipv6_prefixes >= 40)
                        && percentage_increase > 0.0
                        && anomaly_score >= 2.0
                        && now_tick - last_emitted >= 300
                    {
                        emitted_alerts.insert(alert_key, now_tick);
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
                        });
                    }
                }
            }

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
                    let mut alert_subs = s_alert.alert_subscribers.write().await;
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
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(500));
        let mut aggregate_buffer: HashMap<AggregationKey, u32> = HashMap::new();
        let mut last_emitted_transitions: HashMap<String, i64> = HashMap::new();
        loop {
            tokio::select! {
                Some(first_msg) = rx.recv() => {
                    let now = Utc::now().timestamp(); let mut batched = vec![first_msg];
                    while let Ok(msg) = rx.try_recv() { batched.push(msg); if batched.len() >= 5000 { break; } }
                    let mut max_lag = 0; let mut transitions = Vec::new();
                    for (pending, _) in batched {
                        let lag = now - pending.timestamp; if lag > max_lag { max_lag = lag; }
                        s_ingest.global_stats.add_event(now);
                        if pending.source == "ris" { s_ingest.ris_live_stats.add_event(now); } else if pending.source == "routeviews" { s_ingest.routeviews_stats.add_event(now); }
                        if let Some(cs) = s_ingest.class_stats.get(&pending.classification_type) { cs.add_event(now); }
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
                            classification: pending.classification_type
                        };
                        *aggregate_buffer.entry(key).or_insert(0) += 1;

                        if matches!(pending.classification_type, ClassificationType::RouteLeak | ClassificationType::MinorRouteLeak | ClassificationType::Hijack | ClassificationType::Outage) {
                            rw_ingest.write().await.add_event(pending.lat, pending.lon, pending.asn, pending.as_name.clone(), c_ingest.get_as_org(pending.asn), pending.country.clone(), pending.city.clone(), pending.classification_type, now, pending.prefix.clone());
                        }
                        if pending.classification_type != pending.old_classification
                            && let Some(id) = &pending.incident_id {
                                let transition_key = format!("{}:{}", pending.prefix, pending.asn);
                                let last_emitted = last_emitted_transitions.get(&transition_key).copied().unwrap_or(0);
                                if now - last_emitted >= 300 {
                                    last_emitted_transitions.insert(transition_key, now);
                                    let cur_as_name = c_ingest.get_as_name(pending.asn).unwrap_or_default();
                                    transitions.push(StateTransition {
                                        incident_id: id.clone(),
                                        prefix: pending.prefix.clone(),
                                        asn: pending.asn,
                                        as_name: cur_as_name,
                                        geo: Some(ProtoGeoData { lat: pending.lat, lon: pending.lon }),
                                        city: pending.city.clone().unwrap_or_default(),
                                        country: pending.country.clone().unwrap_or_default(),
                                        new_state: map_classification(pending.classification_type).into(),
                                        old_state: map_classification(pending.old_classification).into(),
                                        start_time: pending.incident_start_time,
                                        end_time: if pending.classification_type == ClassificationType::None { now } else { 0 },
                                        leak_detail: pending.leak_detail.as_ref().map(|ld| livemap_proto::LeakDetail {
                                            leak_type: ld.leak_type as u32,
                                            leaker_asn: ld.leaker_asn,
                                            victim_asn: ld.victim_asn,
                                            leaker_as_name: c_ingest.get_as_name(ld.leaker_asn).unwrap_or_default(),
                                            victim_as_name: c_ingest.get_as_name(ld.victim_asn).unwrap_or_default(),
                                            leaker_rpki_status: ld.leaker_rpki_status,
                                            victim_rpki_status: ld.victim_rpki_status
                                        })
                                    });
                                }
                            }
                    }
                    s_ingest.max_lag.store(max_lag as u64, Ordering::Relaxed);
                    if !transitions.is_empty() {
                        let mut subs = s_ingest.transition_subscribers.write().await;
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
                        let resp = SubscribeEventsResponse { events }; let mut subs = s_ingest.subscribers.write().await;
                        subs.retain(|sub| sub.try_send(Ok(resp.clone())).is_ok());
                    }
                }
            }
        }
    });
    let addr = "0.0.0.0:50051".parse().unwrap();
    info!("Starting gRPC server on {}", addr);
    info!("Startup took {}ms", start_instant.elapsed().as_millis());
    Server::builder()
        .add_service(LiveMapServer::new(LiveMapService { state: app_state }))
        .serve(addr)
        .await?;
    Ok(())
}

#[cfg(test)]
mod rolling_windows_test;
#[cfg(test)]
mod stats_test;
