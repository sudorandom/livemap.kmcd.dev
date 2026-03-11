use bgpkit_parser::models::Asn;
use bgpkit_parser::parse_ris_live_message;
use bgpkit_parser::parser::bmp::messages::BmpMessageBody;
use bgpkit_parser::{Elementor, parse_bmp_msg, parse_openbmp_header};
use bytes::Bytes;
use chrono::Utc;
use ipnet::{IpNet, Ipv4Net, Ipv6Net};
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{RwLock, mpsc};
use tungstenite::{Message as WsMessage, connect};

pub mod classifier;
pub mod map;

use classifier::{ClassificationType, Classifier, DiskTrie, MessageContext, PendingEvent};
use map::Geolocation;

pub mod livemap_proto {
    tonic::include_proto!("livemap");
}

use livemap_proto::live_map_server::{LiveMap, LiveMapServer};
use livemap_proto::{
    AggregatedEvent, Classification as ProtoClassification, ClassificationCount,
    GeoData as ProtoGeoData, StreamEventsRequest, StreamEventsResponse, SummaryRequest,
    SummaryResponse,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, transport::Server};

fn map_classification(c: ClassificationType) -> ProtoClassification {
    match c {
        ClassificationType::None => ProtoClassification::None,
        ClassificationType::Bogon => ProtoClassification::Bogon,
        ClassificationType::Hijack => ProtoClassification::Hijack,
        ClassificationType::RouteLeak => ProtoClassification::RouteLeak,
        ClassificationType::Outage => ProtoClassification::Outage,
        ClassificationType::DDoSMitigation => ProtoClassification::DdosMitigation,
        ClassificationType::Flap => ProtoClassification::Flap,
        ClassificationType::TrafficEngineering => ProtoClassification::TrafficEngineering,
        ClassificationType::PathHunting => ProtoClassification::PathHunting,
        ClassificationType::Discovery => ProtoClassification::Discovery,
    }
}

#[derive(Clone, Hash, Eq, PartialEq)]
struct AggregationKey {
    lat_bits: u32,
    lon_bits: u32,
    city: Option<String>,
    country: Option<String>,
    classification: ClassificationType,
}

#[derive(Default)]
struct CumulativeStats {
    msg_count: u32,
    message_timestamps: VecDeque<i64>,
    asns: HashSet<u32>,
    prefixes_v4: HashSet<Ipv4Net>,
    prefixes_v6: HashSet<Ipv6Net>,
}

impl CumulativeStats {
    fn add_event(&mut self, event: &PendingEvent, ts: i64) {
        self.msg_count += 1;
        self.message_timestamps.push_back(ts);
        if event.asn != 0 {
            self.asns.insert(event.asn);
        }
        if let Ok(net) = IpNet::from_str(&event.prefix) {
            match net {
                IpNet::V4(v4) => {
                    self.prefixes_v4.insert(v4);
                }
                IpNet::V6(v6) => {
                    self.prefixes_v6.insert(v6);
                }
            }
        }
    }

    fn cleanup_sliding_window(&mut self, now: i64) {
        let cutoff = now - 60;
        while let Some(&ts) = self.message_timestamps.front() {
            if ts < cutoff {
                self.message_timestamps.pop_front();
            } else {
                break;
            }
        }
    }

    fn calculate_ipv4_count(&self) -> u64 {
        let ipv4_nets: Vec<Ipv4Net> = self.prefixes_v4.iter().cloned().collect();
        let ipv4_aggregated = Ipv4Net::aggregate(&ipv4_nets);
        ipv4_aggregated
            .iter()
            .map(|n| {
                let len = n.prefix_len();
                if len == 0 {
                    u32::MAX as u64 + 1
                } else {
                    1u64 << (32 - len)
                }
            })
            .sum()
    }
}

struct AppState {
    subscribers: Vec<mpsc::Sender<Result<StreamEventsResponse, Status>>>,
    global_stats: CumulativeStats,
    class_stats: HashMap<ClassificationType, CumulativeStats>,
}

struct LiveMapService {
    state: Arc<RwLock<AppState>>,
}

#[tonic::async_trait]
impl LiveMap for LiveMapService {
    type SubscribeEventsStream = ReceiverStream<Result<StreamEventsResponse, Status>>;

    async fn subscribe_events(
        &self,
        _request: Request<StreamEventsRequest>,
    ) -> Result<Response<Self::SubscribeEventsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        self.state.write().await.subscribers.push(tx);
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn get_summary(
        &self,
        _request: Request<SummaryRequest>,
    ) -> Result<Response<SummaryResponse>, Status> {
        let mut state = self.state.write().await;
        let now = Utc::now().timestamp();

        state.global_stats.cleanup_sliding_window(now);
        for c_stats in state.class_stats.values_mut() {
            c_stats.cleanup_sliding_window(now);
        }

        let g_ipv4_count = state.global_stats.calculate_ipv4_count();

        let classification_counts = state
            .class_stats
            .iter()
            .map(|(&k, v)| {
                let c_ipv4_count = v.calculate_ipv4_count();
                ClassificationCount {
                    classification: map_classification(k).into(),
                    count: v.msg_count,
                    messages_per_second: v.message_timestamps.len() as f32 / 60.0,
                    asn_count: v.asns.len() as u32,
                    prefix_count: (v.prefixes_v4.len() + v.prefixes_v6.len()) as u32,
                    ipv4_prefix_count: v.prefixes_v4.len() as u32,
                    ipv6_prefix_count: v.prefixes_v6.len() as u32,
                    ipv4_count: c_ipv4_count,
                }
            })
            .collect();

        Ok(Response::new(SummaryResponse {
            messages_per_second: state.global_stats.message_timestamps.len() as f32 / 60.0,
            asn_count: state.global_stats.asns.len() as u32,
            prefix_count: (state.global_stats.prefixes_v4.len()
                + state.global_stats.prefixes_v6.len()) as u32,
            classification_counts,
            ipv4_prefix_count: state.global_stats.prefixes_v4.len() as u32,
            ipv6_prefix_count: state.global_stats.prefixes_v6.len() as u32,
            ipv4_count: g_ipv4_count,
        }))
    }
}

fn consume_ris_live(classifier: Arc<Classifier>, tx: mpsc::Sender<(PendingEvent, bool)>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        println!("Connecting to RIS Live...");
        match connect("ws://ris-live.ripe.net/v1/ws/") {
            Ok((mut socket, _)) => {
                backoff = Duration::from_secs(1);
                let subscribe_msg = json!({
                    "type": "ris_subscribe",
                })
                .to_string();

                if let Err(e) = socket.send(WsMessage::Text(subscribe_msg.into())) {
                    eprintln!("Failed to send subscribe message: {}. Retrying...", e);
                    std::thread::sleep(backoff);
                    continue;
                }

                println!("Subscribed to RIS Live");

                loop {
                    match socket.read() {
                        Ok(msg) => {
                            if let WsMessage::Text(text) = msg {
                                if let Ok(live_msg) = serde_json::from_str::<
                                    bgpkit_parser::parser::rislive::messages::RisLiveMessage,
                                >(&text)
                                {
                                    if let bgpkit_parser::parser::rislive::messages::RisLiveMessage::RisMessage(ris_msg) = live_msg {
                                        let host = ris_msg.host.clone();
                                        if let Ok(bgp_msg) = parse_ris_live_message(&text) {
                                            let now = Utc::now().timestamp();
                                            for elem in bgp_msg {
                                                let origin_asn = elem.origin_asns.as_ref().and_then(|v| v.first()).map(|asn: &Asn| u32::from(*asn)).unwrap_or_default();
                                                let ctx = MessageContext {
                                                    elem: &elem,
                                                    now,
                                                    host: host.clone(),
                                                    peer: elem.peer_ip.to_string(),
                                                    is_withdrawal: elem.elem_type == bgpkit_parser::models::ElemType::WITHDRAW,
                                                    path_str: elem.as_path.as_ref().map(|p| p.to_string()).unwrap_or_default(),
                                                    comm_str: elem.communities.as_ref().map(|c| c.iter().map(|v| v.to_string()).collect::<Vec<String>>().join(" ")).unwrap_or_default(),
                                                    origin_asn,
                                                    path_len: elem.as_path.as_ref().map(|p| p.segments.iter().count()).unwrap_or(0),
                                                };

                                                let event = classifier.classify_event(elem.prefix.to_string(), &ctx);
                                                let is_classified = event.is_some();
                                                let pending = event.unwrap_or_else(|| PendingEvent {
                                                    prefix: elem.prefix.to_string(),
                                                    asn: origin_asn,
                                                    historical_asn: 0,
                                                    classification_type: ClassificationType::None,
                                                    leak_detail: None,
                                                    anomaly_details: None,
                                                });
                                                let _ = tx.blocking_send((pending, is_classified));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Error reading message: {}. Reconnecting...", e);
                            break; // Break inner loop to reconnect
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "Failed to connect to RIS Live: {}. Retrying in {:?}...",
                    e, backoff
                );
                std::thread::sleep(backoff);
                backoff = (backoff * 2).min(Duration::from_secs(60));
            }
        }
    }
}

async fn consume_routeviews(classifier: Arc<Classifier>, tx: mpsc::Sender<(PendingEvent, bool)>) {
    let mut backoff = Duration::from_secs(5);
    loop {
        println!("Connecting to RouteViews Kafka...");
        let consumer_res: Result<StreamConsumer, _> = ClientConfig::new()
            .set("bootstrap.servers", "stream.routeviews.org:9092")
            .set("group.id", "livemap-grpc-server-v1")
            .set("auto.offset.reset", "latest")
            .create();

        match consumer_res {
            Ok(consumer) => {
                backoff = Duration::from_secs(5);
                if let Err(e) = consumer.subscribe(&["^routeviews\\..*\\.bmp_raw"]) {
                    eprintln!("Failed to subscribe to Kafka topics: {}. Retrying...", e);
                    tokio::time::sleep(backoff).await;
                    continue;
                }

                println!("Subscribed to RouteViews Kafka");

                loop {
                    match consumer.recv().await {
                        Ok(m) => {
                            use rdkafka::Message;
                            if let Some(payload) = m.payload() {
                                let mut bytes = Bytes::copy_from_slice(payload);
                                if let Ok(header) = parse_openbmp_header(&mut bytes) {
                                    if let Ok(msg) = parse_bmp_msg(&mut bytes) {
                                        let now = Utc::now().timestamp();
                                        if let (
                                            Some(per_peer_header),
                                            BmpMessageBody::RouteMonitoring(rm),
                                        ) = (msg.per_peer_header, msg.message_body)
                                        {
                                            for elem in Elementor::bgp_to_elems(
                                                rm.bgp_message,
                                                header.timestamp,
                                                &per_peer_header.peer_ip,
                                                &per_peer_header.peer_asn,
                                            ) {
                                                let origin_asn = elem
                                                    .origin_asns
                                                    .as_ref()
                                                    .and_then(|v| v.first())
                                                    .map(|asn: &Asn| u32::from(*asn))
                                                    .unwrap_or_default();
                                                let ctx = MessageContext {
                                                    elem: &elem,
                                                    now,
                                                    host: "routeviews".to_string(),
                                                    peer: elem.peer_ip.to_string(),
                                                    is_withdrawal: elem.elem_type == bgpkit_parser::models::ElemType::WITHDRAW,
                                                    path_str: elem.as_path.as_ref().map(|p| p.to_string()).unwrap_or_default(),
                                                    comm_str: elem.communities.as_ref().map(|c| c.iter().map(|v| v.to_string()).collect::<Vec<String>>().join(" ")).unwrap_or_default(),
                                                    origin_asn,
                                                    path_len: elem.as_path.as_ref().map(|p| p.segments.iter().count()).unwrap_or(0),
                                                };

                                                let event = classifier
                                                    .classify_event(elem.prefix.to_string(), &ctx);
                                                let is_classified = event.is_some();
                                                let pending =
                                                    event.unwrap_or_else(|| PendingEvent {
                                                        prefix: elem.prefix.to_string(),
                                                        asn: origin_asn,
                                                        historical_asn: 0,
                                                        classification_type:
                                                            ClassificationType::None,
                                                        leak_detail: None,
                                                        anomaly_details: None,
                                                    });
                                                let _ = tx.send((pending, is_classified)).await;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Kafka consumption error: {}. Reconnecting...", e);
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "Failed to create Kafka consumer: {}. Retrying in {:?}...",
                    e, backoff
                );
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(300));
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = sled::open("db/state").expect("Failed to open state database");
    let seen_tree = db.open_tree("seen").expect("Failed to open seen tree");
    let state_db = db;
    let seen_db = DiskTrie::new(seen_tree);

    let classifier = Arc::new(Classifier::new(1000, Some(seen_db), Some(state_db.clone())));
    let (tx, mut rx) = mpsc::channel::<(PendingEvent, bool)>(1000);

    let c1 = classifier.clone();
    let tx1 = tx.clone();
    tokio::task::spawn_blocking(move || {
        consume_ris_live(c1, tx1);
    });

    let c2 = classifier.clone();
    let tx2 = tx.clone();
    tokio::spawn(async move {
        consume_routeviews(c2, tx2).await;
    });

    let geo = Arc::new(Geolocation::new("assets/dbip-city-lite-2026-03.mmdb"));

    let mut global_stats = CumulativeStats::default();
    let mut class_stats: HashMap<ClassificationType, CumulativeStats> = HashMap::new();

    // Load from DB
    println!("Loading historical data from DB...");
    let now = Utc::now().timestamp();
    for item in state_db.iter() {
        if let Ok((key, value)) = item {
            if let Ok(state) = serde_json::from_slice::<classifier::PrefixState>(&value) {
                let prefix = String::from_utf8_lossy(&key).to_string();
                let event = PendingEvent {
                    prefix: prefix.clone(),
                    asn: state.last_origin_asn,
                    historical_asn: 0,
                    classification_type: state.classified_type,
                    leak_detail: None,
                    anomaly_details: None,
                };

                // For global stats we consider everything in the DB as a known prefix
                global_stats.add_event(&event, state.last_update_ts);

                if state.classified_type != ClassificationType::None {
                    let c_stats = class_stats.entry(state.classified_type).or_default();
                    c_stats.add_event(&event, state.classified_time_ts);
                }

                // Add messages count from buckets for sliding window if within range
                for (ts, bucket) in state.buckets {
                    if ts >= now - 60 {
                        for _ in 0..bucket.total_messages {
                            global_stats.message_timestamps.push_back(ts);
                        }
                    }
                }
            }
        }
    }
    println!("Loaded cumulative stats from DB.");

    let app_state = Arc::new(RwLock::new(AppState {
        subscribers: Vec::new(),
        global_stats,
        class_stats,
    }));

    let app_state_agg = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        let mut aggregate_buffer: HashMap<AggregationKey, u32> = HashMap::new();

        loop {
            tokio::select! {
                Some((pending_event, is_classified)) = rx.recv() => {
                    let now = Utc::now().timestamp();
                    let mut state = app_state_agg.write().await;
                    state.global_stats.add_event(&pending_event, now);

                    if is_classified {
                        let c_stats = state.class_stats.entry(pending_event.classification_type).or_default();
                        c_stats.add_event(&pending_event, now);

                        let prefix_parts: Vec<&str> = pending_event.prefix.split('/').collect();
                        if let Ok(ip) = prefix_parts[0].parse::<IpAddr>() {
                            if let Some(geo_data) = geo.lookup(ip) {
                                let key = AggregationKey {
                                    lat_bits: geo_data.lat.to_bits(),
                                    lon_bits: geo_data.lon.to_bits(),
                                    city: geo_data.city,
                                    country: geo_data.country,
                                    classification: pending_event.classification_type,
                                };
                                *aggregate_buffer.entry(key).or_insert(0) += 1;
                            }
                        }
                    }
                }
                _ = interval.tick() => {
                    if !aggregate_buffer.is_empty() {
                        let mut response_events = Vec::new();
                        for (key, count) in aggregate_buffer.drain() {
                            response_events.push(AggregatedEvent {
                                geo: Some(ProtoGeoData {
                                    lat: f32::from_bits(key.lat_bits),
                                    lon: f32::from_bits(key.lon_bits),
                                    city: key.city,
                                    country: key.country,
                                }),
                                classification: map_classification(key.classification).into(),
                                count,
                            });
                        }

                        let response = StreamEventsResponse { events: response_events };

                        let mut state = app_state_agg.write().await;
                        state.subscribers.retain(|sub| {
                            sub.try_send(Ok(response.clone())).is_ok()
                        });
                    }
                }
            }
        }
    });

    let addr = "0.0.0.0:50051".parse().unwrap();
    let service = LiveMapService { state: app_state };
    let server = LiveMapServer::new(service);

    println!("Starting gRPC server on {}", addr);
    Server::builder().add_service(server).serve(addr).await?;

    Ok(())
}
