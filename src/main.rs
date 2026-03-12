use bgpkit_parser::models::Asn;
use bgpkit_parser::parse_ris_live_message;
use bgpkit_parser::parser::bmp::messages::BmpMessageBody;
use bgpkit_parser::{Elementor, parse_bmp_msg, parse_openbmp_header};
use bytes::Bytes;
use chrono::Utc;
use ipnet::{IpNet, Ipv4Net, Ipv6Net};
use parking_lot::RwLock;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rdkafka::config::ClientConfig;
use rdkafka::consumer::{Consumer, StreamConsumer};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
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
    SummaryResponse, StateTransition, StreamStateTransitionsRequest, StreamStateTransitionsResponse,
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
    classification: ClassificationType,
}

fn default_rate_buckets() -> Vec<u32> {
    vec![0; 60]
}

#[derive(Serialize, Deserialize, Clone)]
struct CumulativeStats {
    pub msg_count: u64,
    #[serde(skip, default = "default_rate_buckets")]
    pub rate_buckets: Vec<u32>,
    #[serde(skip)]
    pub last_bucket_ts: i64,
    pub asns: HashSet<u32>,
    pub prefixes_v4: HashSet<Ipv4Net>,
    pub prefixes_v6: HashSet<Ipv6Net>,
}

impl Default for CumulativeStats {
    fn default() -> Self {
        Self {
            msg_count: 0,
            rate_buckets: default_rate_buckets(),
            last_bucket_ts: 0,
            asns: HashSet::new(),
            prefixes_v4: HashSet::new(),
            prefixes_v6: HashSet::new(),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Checkpoint {
    pub global_stats: CumulativeStats,
    pub class_stats: HashMap<ClassificationType, CumulativeStats>,
    pub timestamp: i64,
}

impl CumulativeStats {
    fn cleanup_buckets(&mut self, now: i64) {
        if now > self.last_bucket_ts {
            let mut t = self.last_bucket_ts + 1;
            while t <= now && (t - self.last_bucket_ts) <= 60 {
                self.rate_buckets[(t % 60) as usize] = 0;
                t += 1;
            }
            self.last_bucket_ts = now;
        }
    }

    fn add_event(&mut self, _event: &PendingEvent, _net: Option<IpNet>, ts: i64) {
        self.msg_count += 1;
        
        // Ensure rate_buckets is initialized (safety for deserialization)
        if self.rate_buckets.is_empty() {
            self.rate_buckets = default_rate_buckets();
        }

        self.cleanup_buckets(ts);
        let bucket_idx = (ts % 60) as usize;
        self.rate_buckets[bucket_idx] += 1;
    }

    fn get_current_rate(&self, now: i64, start_ts: i64) -> f32 {
        if now - self.last_bucket_ts >= 60 || self.rate_buckets.is_empty() {
            return 0.0;
        }
        let elapsed = (now - start_ts).max(1);
        let divisor = elapsed.min(60) as f32;
        let total: u32 = self.rate_buckets.iter().sum();
        total as f32 / divisor
    }
}

struct AppState {
    subscribers: Vec<mpsc::Sender<Result<StreamEventsResponse, Status>>>,
    transition_subscribers: Vec<(mpsc::Sender<Result<StreamStateTransitionsResponse, Status>>, HashSet<ClassificationType>)>,
    global_stats: CumulativeStats,
    class_stats: HashMap<ClassificationType, CumulativeStats>,
    input_tx: mpsc::Sender<(PendingEvent, bool)>,
    max_lag: i64,
    ingestion_start_ts: i64,
    cached_global_ipv4_count: u64,
    cached_class_ipv4_counts: HashMap<ClassificationType, u64>,
    loading_historical: bool,
}

struct LiveMapService {
    state: Arc<RwLock<AppState>>,
}

#[tonic::async_trait]
impl LiveMap for LiveMapService {
    type SubscribeEventsStream = ReceiverStream<Result<StreamEventsResponse, Status>>;
    type StreamStateTransitionsStream = ReceiverStream<Result<StreamStateTransitionsResponse, Status>>;

    async fn subscribe_events(
        &self,
        _request: Request<StreamEventsRequest>,
    ) -> Result<Response<Self::SubscribeEventsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        self.state.write().subscribers.push(tx);
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn stream_state_transitions(
        &self,
        request: Request<StreamStateTransitionsRequest>,
    ) -> Result<Response<Self::StreamStateTransitionsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        let req = request.into_inner();
        let target_states: HashSet<ClassificationType> = req.target_states
            .into_iter()
            .filter_map(|val| {
                if val == ProtoClassification::None as i32 {
                    Some(ClassificationType::None)
                } else if val == ProtoClassification::Bogon as i32 {
                    Some(ClassificationType::Bogon)
                } else if val == ProtoClassification::Hijack as i32 {
                    Some(ClassificationType::Hijack)
                } else if val == ProtoClassification::RouteLeak as i32 {
                    Some(ClassificationType::RouteLeak)
                } else if val == ProtoClassification::Outage as i32 {
                    Some(ClassificationType::Outage)
                } else if val == ProtoClassification::DdosMitigation as i32 {
                    Some(ClassificationType::DDoSMitigation)
                } else if val == ProtoClassification::Flap as i32 {
                    Some(ClassificationType::Flap)
                } else if val == ProtoClassification::TrafficEngineering as i32 {
                    Some(ClassificationType::TrafficEngineering)
                } else if val == ProtoClassification::PathHunting as i32 {
                    Some(ClassificationType::PathHunting)
                } else if val == ProtoClassification::Discovery as i32 {
                    Some(ClassificationType::Discovery)
                } else {
                    None
                }
            })
            .collect();

        self.state.write().transition_subscribers.push((tx, target_states));
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    async fn get_summary(
        &self,
        _request: Request<SummaryRequest>,
    ) -> Result<Response<SummaryResponse>, Status> {
        let now = Utc::now().timestamp();
        let mut state = self.state.write();

        state.global_stats.cleanup_buckets(now);
        for v in state.class_stats.values_mut() {
            v.cleanup_buckets(now);
        }

        let start_ts = state.ingestion_start_ts;
        let msgs_per_sec = state.global_stats.get_current_rate(now, start_ts);
        let global_asn_count = state.global_stats.asns.len() as u32;
        let global_prefix_count =
            (state.global_stats.prefixes_v4.len() + state.global_stats.prefixes_v6.len()) as u32;
        let global_ipv4_prefix_count = state.global_stats.prefixes_v4.len() as u32;
        let global_ipv6_prefix_count = state.global_stats.prefixes_v6.len() as u32;

        let input_channel_len = (10000 - state.input_tx.capacity()) as u32;
        let input_channel_capacity = 10000;
        let max_lag_seconds = state.max_lag as u32;
        
        let g_ipv4_count = state.cached_global_ipv4_count;

        let mut classification_counts = Vec::new();
        for (&k, v) in state.class_stats.iter() {
            let c_ipv4_count = state.cached_class_ipv4_counts.get(&k).cloned().unwrap_or(0);
            let window_count = v.rate_buckets.iter().sum::<u32>();
            classification_counts.push(ClassificationCount {
                classification: map_classification(k).into(),
                count: window_count,
                messages_per_second: v.get_current_rate(now, start_ts),
                asn_count: v.asns.len() as u32,
                prefix_count: (v.prefixes_v4.len() + v.prefixes_v6.len()) as u32,
                ipv4_prefix_count: v.prefixes_v4.len() as u32,
                ipv6_prefix_count: v.prefixes_v6.len() as u32,
                ipv4_count: c_ipv4_count,
                total_count: v.msg_count,
            });
        }

        Ok(Response::new(SummaryResponse {
            messages_per_second: msgs_per_sec,
            asn_count: global_asn_count,
            prefix_count: global_prefix_count,
            classification_counts,
            ipv4_prefix_count: global_ipv4_prefix_count,
            ipv6_prefix_count: global_ipv6_prefix_count,
            ipv4_count: g_ipv4_count,
            input_channel_len,
            input_channel_capacity,
            max_lag_seconds,
            loading_historical: state.loading_historical,
        }))
    }
}

async fn process_ris_live_message(
    text: &str,
    classifier: &Classifier,
    tx: &mpsc::Sender<(PendingEvent, bool)>,
) -> Result<(), Box<dyn std::error::Error>> {
    let bgp_msg = parse_ris_live_message(text)?;
    let now = Utc::now().timestamp();

    for elem in bgp_msg {
        let host = elem.peer_ip.to_string();
        let origin_asn = elem
            .origin_asns
            .as_ref()
            .and_then(|v| v.first())
            .map(|asn: &Asn| u32::from(*asn))
            .unwrap_or_default();
        let ctx = MessageContext {
            elem: &elem,
            now,
            host: host.clone(),
            peer: elem.peer_ip.to_string(),
            is_withdrawal: elem.elem_type == bgpkit_parser::models::ElemType::WITHDRAW,
            path_str: elem
                .as_path
                .as_ref()
                .map(|p| p.to_string())
                .unwrap_or_default(),
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
            path_len: elem.as_path.as_ref().map(|p| p.segments.len()).unwrap_or(0),
        };

        let event = classifier.classify_event(elem.prefix.to_string(), &ctx);
        let is_classified = event.is_some();
        let pending = event.unwrap_or_else(|| PendingEvent {
            prefix: elem.prefix.to_string(),
            asn: origin_asn,
            peer_ip: host.clone(),
            historical_asn: 0,
            timestamp: now,
            classification_type: ClassificationType::None,
            old_classification: ClassificationType::None,
            incident_id: None,
            leak_detail: None,
            anomaly_details: None,
        });
        let _ = tx.send((pending, is_classified)).await;
    }

    Ok(())
}

fn consume_ris_live(classifier: Arc<Classifier>, tx: mpsc::Sender<(PendingEvent, bool)>) {
    let mut backoff = Duration::from_secs(1);
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

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
                                let c = classifier.clone();
                                let t = tx.clone();
                                rt.block_on(async move {
                                    if let Err(_e) = process_ris_live_message(&text, &c, &t).await {
                                        // Ignore or log
                                    }
                                });
                            }
                        }
                        Err(e) => {
                            eprintln!("Error reading message: {}. Reconnecting...", e);
                            break;
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

async fn process_routeviews_message(
    payload: &[u8],
    classifier: &Classifier,
    tx: &mpsc::Sender<(PendingEvent, bool)>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Bytes::copy_from_slice(payload);
    let header = parse_openbmp_header(&mut bytes)?;
    let msg = parse_bmp_msg(&mut bytes)?;
    let now = Utc::now().timestamp();

    if let (Some(per_peer_header), BmpMessageBody::RouteMonitoring(rm)) =
        (msg.per_peer_header, msg.message_body)
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
                path_str: elem
                    .as_path
                    .as_ref()
                    .map(|p| p.to_string())
                    .unwrap_or_default(),
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
                path_len: elem.as_path.as_ref().map(|p| p.segments.len()).unwrap_or(0),
            };

            let event = classifier.classify_event(elem.prefix.to_string(), &ctx);
            let is_classified = event.is_some();
            let pending = event.unwrap_or_else(|| PendingEvent {
                prefix: elem.prefix.to_string(),
                asn: origin_asn,
                peer_ip: "routeviews".to_string(),
                historical_asn: 0,
                timestamp: now,
                classification_type: ClassificationType::None,
                old_classification: ClassificationType::None,
                incident_id: None,
                leak_detail: None,
                anomaly_details: None,
            });
            let _ = tx.send((pending, is_classified)).await;
        }
    }

    Ok(())
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

                println!("Subscribed to RouteViews Kafka topics");

                loop {
                    match consumer.recv().await {
                        Ok(msg) => {
                            use rdkafka::message::Message;
                            if let Some(payload) = msg.payload() {
                                if let Err(_e) =
                                    process_routeviews_message(payload, &classifier, &tx).await
                                {
                                    // Log or ignore
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Kafka error: {}. Reconnecting...", e);
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
    let sled_db = sled::open("db/sled").expect("Failed to open sled database");
    let seen_db_inner = DiskTrie::new(sled_db.open_tree("seen").expect("Failed to open seen tree"));
    let checkpoint_db = sled_db.open_tree("checkpoints").expect("Failed to open checkpoints tree");

    let manager = SqliteConnectionManager::file("db/state.db");
    let sqlite_pool = Pool::new(manager).expect("Failed to create SQLite pool");
    
    // Initialize SQLite schema
    if let Ok(conn) = sqlite_pool.get() {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS prefix_state (
                 prefix TEXT PRIMARY KEY,
                 state TEXT,
                 last_update_ts INTEGER,
                 classified_type INTEGER,
                 origin_asn INTEGER DEFAULT 0
             );"
        ).expect("Failed to initialize SQLite schema");
        
        // Attempt to add column to existing DB, ignoring errors if it already exists
        let _ = conn.execute("ALTER TABLE prefix_state ADD COLUMN origin_asn INTEGER DEFAULT 0", []);
    }

    let state_db_clone = sqlite_pool.clone();

    let classifier = tokio::task::spawn_blocking(move || {
        Arc::new(Classifier::new(100000, Some(seen_db_inner), Some(state_db_clone)))
    })
    .await
    .expect("Failed to initialize classifier");

    let (tx, mut rx) = mpsc::channel::<(PendingEvent, bool)>(10000);

    let geo = Arc::new(Geolocation::new("assets/dbip-city-lite-2026-03.mmdb"));

    // Try to load latest checkpoint
    let mut initial_global_stats = CumulativeStats::default();
    let mut initial_class_stats = HashMap::new();
    let mut loading_historical = true;

    if let Ok(Some(data)) = checkpoint_db.get("latest") {
        if let Ok(cp) = serde_json::from_slice::<Checkpoint>(&data) {
            println!("Loaded checkpoint from DB (timestamp: {}).", cp.timestamp);
            initial_global_stats = cp.global_stats;
            initial_class_stats = cp.class_stats;
            let now_ts = Utc::now().timestamp();
            if now_ts - cp.timestamp < 3600 {
                loading_historical = false;
            }
        }
    }

    let app_state = Arc::new(RwLock::new(AppState {
        subscribers: Vec::new(),
        transition_subscribers: Vec::new(),
        global_stats: initial_global_stats,
        class_stats: initial_class_stats,
        input_tx: tx.clone(),
        max_lag: 0,
        ingestion_start_ts: Utc::now().timestamp(),
        cached_global_ipv4_count: 0,
        cached_class_ipv4_counts: HashMap::new(),
        loading_historical,
    }));

    // Start background consumers immediately
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

    let app_state_ipv4 = app_state.clone();
    let app_state_log = app_state.clone();

    // Periodic Ingestion Logging
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let now = Utc::now().timestamp();
            let state = app_state_log.read();
            let rate = state.global_stats.get_current_rate(now, state.ingestion_start_ts);
            println!(
                "[INGEST] Rate: {:.1} msg/s | Total: {} | Lag: {}s | DB Load: {}",
                rate,
                state.global_stats.msg_count,
                state.max_lag,
                if state.loading_historical { "In Progress" } else { "Complete" }
            );
        }
    });

    // Periodic Checkpoint Saving
    let app_state_cp = app_state.clone();
    let checkpoint_db_save = checkpoint_db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300)); // Every 5 minutes
        loop {
            interval.tick().await;
            let cp = {
                let state = app_state_cp.read();
                Checkpoint {
                    global_stats: state.global_stats.clone(),
                    class_stats: state.class_stats.clone(),
                    timestamp: Utc::now().timestamp(),
                }
            };
            if let Ok(data) = serde_json::to_vec(&cp) {
                let _ = checkpoint_db_save.insert("latest", data);
                let _ = checkpoint_db_save.flush();
                println!("[DB] Saved checkpoint to disk.");
            }
        }
    });

    // Background State Synchronizer (mutually exclusive snapshot from SQLite)
    let sync_pool = sqlite_pool.clone();
    tokio::spawn(async move {
        // Wait a few seconds to let initial checkpoint / ingestion settle
        tokio::time::sleep(Duration::from_secs(5)).await;
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;

            let trueup_pool_clone = sync_pool.clone();
            let summary = tokio::task::spawn_blocking(move || {
                let mut class_asns: HashMap<ClassificationType, HashSet<u32>> = HashMap::new();
                let mut class_v4: HashMap<ClassificationType, Vec<Ipv4Net>> = HashMap::new();
                let mut class_v6: HashMap<ClassificationType, Vec<Ipv6Net>> = HashMap::new();
                
                let mut global_asns = HashSet::new();
                let mut global_v4 = Vec::new();
                let mut global_v6 = Vec::new();

                if let Ok(conn) = trueup_pool_clone.get() {
                    // Try to extract msg count via string match or just rely on state length for a rough proxy if JSON parse is too slow.
                    // Actually, parsing JSON for 1M records every 10s is too slow. We will NOT update msg_count here. 
                    // msg_count is cumulative forever and handles increments via ingestion.
                    // We only rebuild ASNs and Prefixes which need to be mutually exclusive.
                    if let Ok(mut stmt) = conn.prepare("SELECT prefix, classified_type, origin_asn FROM prefix_state") {
                        let mut rows = stmt.query([]).unwrap();
                        while let Ok(Some(row)) = rows.next() {
                            let prefix_str: String = row.get(0).unwrap();
                            let c_type_i32: i32 = row.get(1).unwrap();
                            let origin_asn: u32 = row.get(2).unwrap();
                            
                            let c_type = ClassificationType::from_i32(c_type_i32);

                            if let Ok(net) = IpNet::from_str(&prefix_str) {
                                if origin_asn != 0 {
                                    global_asns.insert(origin_asn);
                                    class_asns.entry(c_type).or_default().insert(origin_asn);
                                }

                                match net {
                                    IpNet::V4(v4) => {
                                        global_v4.push(v4);
                                        class_v4.entry(c_type).or_default().push(v4);
                                    }
                                    IpNet::V6(v6) => {
                                        global_v6.push(v6);
                                        class_v6.entry(c_type).or_default().push(v6);
                                    }
                                }
                            }
                        }
                    }
                }

                // Compute Ipv4 Counts
                let global_ipv4_count = if global_v4.is_empty() { 0 } else {
                    Ipv4Net::aggregate(&global_v4).iter().map(|n| {
                        let len = n.prefix_len();
                        if len == 0 { u32::MAX as u64 + 1 } else { 1u64 << (32 - len) }
                    }).sum::<u64>()
                };

                let mut class_ipv4_counts = HashMap::new();
                for (k, nets) in &class_v4 {
                    let count = if nets.is_empty() { 0 } else {
                        Ipv4Net::aggregate(nets).iter().map(|n| {
                            let len = n.prefix_len();
                            if len == 0 { u32::MAX as u64 + 1 } else { 1u64 << (32 - len) }
                        }).sum::<u64>()
                    };
                    class_ipv4_counts.insert(*k, count);
                }

                (global_asns, global_v4, global_v6, global_ipv4_count, class_asns, class_v4, class_v6, class_ipv4_counts)
            }).await.unwrap();

            let mut state = app_state_ipv4.write();
            
            // Overwrite the sets and counts for perfect mutual exclusion
            state.global_stats.asns = summary.0;
            state.global_stats.prefixes_v4 = summary.1.into_iter().collect();
            state.global_stats.prefixes_v6 = summary.2.into_iter().collect();
            state.cached_global_ipv4_count = summary.3;

            // Clear old sets
            for v in state.class_stats.values_mut() {
                v.asns.clear();
                v.prefixes_v4.clear();
                v.prefixes_v6.clear();
            }

            for (k, asns) in summary.4 {
                state.class_stats.entry(k).or_default().asns = asns;
            }
            for (k, v4) in summary.5 {
                state.class_stats.entry(k).or_default().prefixes_v4 = v4.into_iter().collect();
            }
            for (k, v6) in summary.6 {
                state.class_stats.entry(k).or_default().prefixes_v6 = v6.into_iter().collect();
            }
            state.cached_class_ipv4_counts = summary.7;
            state.loading_historical = false;
        }
    });

    let cleanup_pool = sqlite_pool.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600)); // Every hour
        loop {
            interval.tick().await;
            println!("Starting background DB cleanup...");
            
            if let Ok(conn) = cleanup_pool.get() {
                let now = Utc::now().timestamp();
                // We want to delete old entries where has_active_peers is false and is_stale.
                // We stored last_update_ts in SQLite. The 'active_peers' logic is in the state JSON.
                // This is a slow task so we can just iterate over the older rows.
                let mut keys_to_remove = Vec::new();
                let stale_threshold = now - 86400; // 24h

                if let Ok(mut stmt) = conn.prepare("SELECT prefix, state FROM prefix_state WHERE last_update_ts < ?1") {
                    let mut rows = stmt.query([stale_threshold]).unwrap();
                    while let Ok(Some(row)) = rows.next() {
                        let prefix: String = row.get(0).unwrap();
                        let state_str: String = row.get(1).unwrap();
                        if let Ok(state) = serde_json::from_str::<classifier::PrefixState>(&state_str) {
                            let has_active_peers = state.peer_last_attrs.values().any(|attr| !attr.withdrawn);
                            if !has_active_peers {
                                keys_to_remove.push(prefix);
                            }
                        }
                    }
                }

                let num_removed = keys_to_remove.len();
                for chunk in keys_to_remove.chunks(900) {
                    let placeholders = vec!["?"; chunk.len()].join(",");
                    let query = format!("DELETE FROM prefix_state WHERE prefix IN ({})", placeholders);
                    let params: Vec<&dyn rusqlite::ToSql> = chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                    let _ = conn.execute(&query, rusqlite::params_from_iter(params));
                }

                if num_removed > 0 {
                    println!("Removed {} stale prefixes from DB.", num_removed);
                }
            }
        }
    });

    // Ingestion loop
    let app_state_ingest = app_state.clone();
    let geo_ingest = geo.clone();
    let classifier_ingest = classifier.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        let mut aggregate_buffer: HashMap<AggregationKey, u32> = HashMap::new();

        loop {
            tokio::select! {
                Some(first_msg) = rx.recv() => {
                    let now = Utc::now().timestamp();
                    let mut batched_events = Vec::new();
                    batched_events.push(first_msg);

                    while let Ok(msg) = rx.try_recv() {
                        batched_events.push(msg);
                        if batched_events.len() >= 2000 { break; }
                    }

                    let mut current_max_lag = 0;
                    let mut processed = Vec::new();
                    let mut transitions = Vec::new();
                    
                    for (pending_event, _is_classified) in batched_events {
                        let lag = now - pending_event.timestamp;
                        if lag > current_max_lag { current_max_lag = lag; }

                        let net = IpNet::from_str(&pending_event.prefix).ok();
                        let mut geo_data = None;
                        if let Ok(peer_ip) = pending_event.peer_ip.parse::<IpAddr>() {
                            geo_data = geo_ingest.lookup(peer_ip);
                        }
                        if geo_data.is_none() {
                            if let Some(n) = net { geo_data = geo_ingest.lookup(n.addr()); }
                        }

                        let geo_key = geo_data.as_ref().map(|gd| AggregationKey {
                            lat_bits: gd.lat.to_bits(),
                            lon_bits: gd.lon.to_bits(),
                            classification: pending_event.classification_type,
                        });

                        // Check for state transition
                        if pending_event.classification_type != pending_event.old_classification {
                            if let Some(incident_id) = &pending_event.incident_id {
                                let mut as_name = String::new();
                                if let Some(ref b) = classifier_ingest.bgpkit {
                                    if let Ok(Some(info)) = b.asinfo_get(pending_event.asn) {
                                        as_name = info.name;
                                    }
                                }

                                let start_time = if pending_event.classification_type == ClassificationType::None {
                                    0 // It's an end event, start_time is usually tracked in state, but we'll leave it 0 here for simplicity
                                } else {
                                    now
                                };

                                let end_time = if pending_event.classification_type == ClassificationType::None {
                                    now
                                } else {
                                    0
                                };

                                let city_str = geo_data.as_ref().and_then(|gd| gd.city.clone()).unwrap_or_default();
                                let country_str = geo_data.as_ref().and_then(|gd| gd.country.clone()).unwrap_or_default();
                                let lat = geo_data.as_ref().map(|gd| gd.lat).unwrap_or(0.0);
                                let lon = geo_data.as_ref().map(|gd| gd.lon).unwrap_or(0.0);

                                transitions.push(StateTransition {
                                    incident_id: incident_id.clone(),
                                    prefix: pending_event.prefix.clone(),
                                    asn: pending_event.asn,
                                    as_name,
                                    geo: Some(ProtoGeoData { lat, lon }),
                                    city: city_str,
                                    country: country_str,
                                    new_state: map_classification(pending_event.classification_type).into(),
                                    old_state: map_classification(pending_event.old_classification).into(),
                                    start_time,
                                    end_time,
                                });
                            }
                        }

                        processed.push((pending_event, net, geo_key));
                    }

                    {
                        let mut state = app_state_ingest.write();
                        state.max_lag = current_max_lag;
                        for (pending_event, net, geo_key) in processed {
                            state.global_stats.add_event(&pending_event, net, now);
                            state.class_stats.entry(pending_event.classification_type)
                                .or_default()
                                .add_event(&pending_event, net, now);

                            if let Some(key) = geo_key {
                                *aggregate_buffer.entry(key).or_insert(0) += 1;
                            }
                        }

                        if !transitions.is_empty() {
                            state.transition_subscribers.retain(|(sub, target_states)| {
                                let mut alive = true;
                                for t in &transitions {
                                    // Map ProtoClassification back to ClassificationType to check against target_states
                                    // or just compare directly.
                                    // A simpler way is to broadcast to all if they want it.
                                    let c_type = ClassificationType::from_i32(t.new_state);
                                    let old_type = ClassificationType::from_i32(t.old_state);
                                    
                                    if target_states.is_empty() || target_states.contains(&c_type) || target_states.contains(&old_type) {
                                        let resp = StreamStateTransitionsResponse { transition: Some(t.clone()) };
                                        if sub.try_send(Ok(resp)).is_err() {
                                            alive = false;
                                            break;
                                        }
                                    }
                                }
                                alive
                            });
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
                                }),
                                classification: map_classification(key.classification).into(),
                                count,
                            });
                        }

                        let response = StreamEventsResponse { events: response_events };
                        let state = app_state_ingest.read();
                        for sub in &state.subscribers {
                            let _ = sub.try_send(Ok(response.clone()));
                        }
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
