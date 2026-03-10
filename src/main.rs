use bgpkit_parser::parse_ris_live_message;
use bgpkit_parser::{parse_openbmp_header, parse_bmp_msg, Elementor};
use bgpkit_parser::models::Asn;
use bgpkit_parser::parser::bmp::messages::BmpMessageBody;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::config::ClientConfig;
use tungstenite::{connect, Message as WsMessage};
use bytes::Bytes;
use serde_json::json;
use std::sync::Arc;
use chrono::Utc;
use tokio::sync::{mpsc, RwLock};
use std::net::IpAddr;
use std::time::Duration;
use std::collections::{HashMap, VecDeque};

pub mod classifier;
pub mod map;

use classifier::{Classifier, MessageContext, PendingEvent, DiskTrie, ClassificationType};
use map::Geolocation;

pub mod livemap_proto {
    tonic::include_proto!("livemap");
}

use livemap_proto::live_map_server::{LiveMap, LiveMapServer};
use livemap_proto::{
    AggregatedEvent, ClassificationCount, GeoData as ProtoGeoData, StreamEventsRequest,
    StreamEventsResponse, SummaryRequest, SummaryResponse, Classification as ProtoClassification,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{transport::Server, Request, Response, Status};

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

struct AppState {
    // Broadcasters for the streaming RPC
    subscribers: Vec<mpsc::Sender<Result<StreamEventsResponse, Status>>>,
    // 60-second sliding window for summary
    recent_events: VecDeque<(i64, PendingEvent)>,
    message_count_60s: u32,
}

struct LiveMapService {
    state: Arc<RwLock<AppState>>,
}

struct Stats {
    count: u32,
    asn_set: std::collections::HashSet<u32>,
    prefix_set: std::collections::HashSet<String>,
    ipv4_prefix_set: std::collections::HashSet<String>,
    ipv6_prefix_set: std::collections::HashSet<String>,
    ip_set: std::collections::HashSet<IpAddr>,
    ipv4_set: std::collections::HashSet<IpAddr>,
    ipv6_set: std::collections::HashSet<IpAddr>,
}

impl Stats {
    fn new() -> Self {
        Self {
            count: 0,
            asn_set: std::collections::HashSet::new(),
            prefix_set: std::collections::HashSet::new(),
            ipv4_prefix_set: std::collections::HashSet::new(),
            ipv6_prefix_set: std::collections::HashSet::new(),
            ip_set: std::collections::HashSet::new(),
            ipv4_set: std::collections::HashSet::new(),
            ipv6_set: std::collections::HashSet::new(),
        }
    }
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
        let state = self.state.read().await;
        
        let mut global_stats = Stats::new();
        let mut class_stats: HashMap<ClassificationType, Stats> = HashMap::new();

        for (_, event) in &state.recent_events {
            global_stats.count += 1;
            global_stats.asn_set.insert(event.asn);
            global_stats.prefix_set.insert(event.prefix.clone());

            let c_stats = class_stats.entry(event.classification_type).or_insert_with(Stats::new);
            c_stats.count += 1;
            c_stats.asn_set.insert(event.asn);
            c_stats.prefix_set.insert(event.prefix.clone());

            let parts: Vec<&str> = event.prefix.split('/').collect();
            if let Ok(ip) = parts[0].parse::<IpAddr>() {
                global_stats.ip_set.insert(ip);
                c_stats.ip_set.insert(ip);

                if ip.is_ipv4() {
                    global_stats.ipv4_prefix_set.insert(event.prefix.clone());
                    global_stats.ipv4_set.insert(ip);
                    c_stats.ipv4_prefix_set.insert(event.prefix.clone());
                    c_stats.ipv4_set.insert(ip);
                } else if ip.is_ipv6() {
                    global_stats.ipv6_prefix_set.insert(event.prefix.clone());
                    global_stats.ipv6_set.insert(ip);
                    c_stats.ipv6_prefix_set.insert(event.prefix.clone());
                    c_stats.ipv6_set.insert(ip);
                }
            }
        }

        let classification_counts = class_stats
            .into_iter()
            .map(|(k, v)| ClassificationCount {
                classification: map_classification(k).into(),
                count: v.count,
                messages_per_second: v.count as f32 / 60.0,
                asn_count: v.asn_set.len() as u32,
                prefix_count: v.prefix_set.len() as u32,
                ip_count: v.ip_set.len() as u32,
                ipv4_prefix_count: v.ipv4_prefix_set.len() as u32,
                ipv6_prefix_count: v.ipv6_prefix_set.len() as u32,
                ipv4_count: v.ipv4_set.len() as u32,
                ipv6_count: v.ipv6_set.len() as u32,
            })
            .collect();

        Ok(Response::new(SummaryResponse {
            messages_per_second: state.message_count_60s as f32 / 60.0,
            asn_count: global_stats.asn_set.len() as u32,
            prefix_count: global_stats.prefix_set.len() as u32,
            ip_count: global_stats.ip_set.len() as u32,
            classification_counts,
            ipv4_prefix_count: global_stats.ipv4_prefix_set.len() as u32,
            ipv6_prefix_count: global_stats.ipv6_prefix_set.len() as u32,
            ipv4_count: global_stats.ipv4_set.len() as u32,
            ipv6_count: global_stats.ipv6_set.len() as u32,
        }))
    }
}

fn consume_ris_live(classifier: Arc<Classifier>, tx: mpsc::Sender<(PendingEvent, bool)>) {
    let (mut socket, _) = connect("ws://ris-live.ripe.net/v1/ws/").expect("Can't connect");

    let subscribe_msg = json!({
        "type": "ris_subscribe",
    }).to_string();
    
    socket.send(WsMessage::Text(subscribe_msg.into())).unwrap();

    loop {
        let msg = socket.read().expect("Error reading message");
        if let WsMessage::Text(text) = msg {
            if let Ok(bgp_msg) = parse_ris_live_message(&text) {
                let now = Utc::now().timestamp();
                for elem in bgp_msg {
                    let origin_asn = elem.origin_asns.as_ref().and_then(|v| v.first()).map(|asn: &Asn| u32::from(*asn)).unwrap_or_default();
                    let ctx = MessageContext {
                        elem: &elem,
                        now,
                        host: "rrc21".to_string(),
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

async fn consume_routeviews(classifier: Arc<Classifier>, tx: mpsc::Sender<(PendingEvent, bool)>) {
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", "bmp.routeviews.org:9092")
        .set("group.id", "livemap-grpc-server")
        .create()
        .expect("Consumer creation failed");

    consumer.subscribe(&["routeviews.linx.bmp.raw"]).unwrap();

    loop {
        match consumer.recv().await {
            Ok(m) => {
                use rdkafka::Message;
                if let Some(payload) = m.payload() {
                    let mut bytes = Bytes::copy_from_slice(payload);
                    if let Ok(header) = parse_openbmp_header(&mut bytes) {
                        if let Ok(msg) = parse_bmp_msg(&mut bytes) {
                            let now = Utc::now().timestamp();
                            if let (Some(per_peer_header), BmpMessageBody::RouteMonitoring(rm)) = (msg.per_peer_header, msg.message_body) {
                                for elem in Elementor::bgp_to_elems(
                                    rm.bgp_message,
                                    header.timestamp,
                                    &per_peer_header.peer_ip,
                                    &per_peer_header.peer_asn,
                                ) {
                                    let origin_asn = elem.origin_asns.as_ref().and_then(|v| v.first()).map(|asn: &Asn| u32::from(*asn)).unwrap_or_default();
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
                                    let _ = tx.send((pending, is_classified)).await;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => eprintln!("Kafka error: {}", e),
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = sled::open("db/state").expect("Failed to open state database");
    let seen_tree = db.open_tree("seen").expect("Failed to open seen tree");
    let state_db = db;
    let seen_db = DiskTrie::new(seen_tree);

    let classifier = Arc::new(Classifier::new(1000, Some(seen_db), Some(state_db)));
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
    
    let app_state = Arc::new(RwLock::new(AppState {
        subscribers: Vec::new(),
        recent_events: VecDeque::new(),
        message_count_60s: 0,
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
                    state.recent_events.push_back((now, pending_event.clone()));
                    state.message_count_60s += 1;
                    
                    let cutoff = now - 60;
                    while let Some((ts, _)) = state.recent_events.front() {
                        if *ts < cutoff {
                            state.recent_events.pop_front();
                            state.message_count_60s = state.message_count_60s.saturating_sub(1);
                        } else {
                            break;
                        }
                    }
                    drop(state);

                    if is_classified {
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
    Server::builder()
        .add_service(server)
        .serve(addr)
        .await?;

    Ok(())
}
