use crate::db::Db;
use ipnet::IpNet;
use log::debug;
use lru::LruCache;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::num::NonZeroUsize;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct DiskTrie {
    tree: sled::Tree,
}

impl DiskTrie {
    pub fn new(tree: sled::Tree) -> Self {
        Self { tree }
    }
    fn make_key_v4(ip: std::net::Ipv4Addr, prefix_len: u8) -> Vec<u8> {
        let octets = ip.octets();
        vec![4, octets[0], octets[1], octets[2], octets[3], prefix_len]
    }
    fn make_key_v6(ip: std::net::Ipv6Addr, prefix_len: u8) -> Vec<u8> {
        let octets = ip.octets();
        let mut key = vec![6];
        key.extend_from_slice(&octets);
        key.push(prefix_len);
        key
    }
    pub fn insert(&self, prefix: IpNet, value: &[u8]) -> sled::Result<()> {
        match prefix.addr() {
            IpAddr::V4(v4) => {
                let key = Self::make_key_v4(v4, prefix.prefix_len());
                self.tree.insert(key, value)?;
            }
            IpAddr::V6(v6) => {
                let key = Self::make_key_v6(v6, prefix.prefix_len());
                self.tree.insert(key, value)?;
            }
        }
        Ok(())
    }
    pub fn lookup_lpm_v4(&self, ip: std::net::Ipv4Addr) -> sled::Result<Option<(u8, Vec<u8>)>> {
        for len in (0..=32).rev() {
            let mask = !((1u64 << (32 - len)) - 1) as u32;
            let masked_ip = std::net::Ipv4Addr::from(u32::from(ip) & mask);
            let key = Self::make_key_v4(masked_ip, len as u8);
            if let Some(val) = self.tree.get(key)? {
                return Ok(Some((len as u8, val.to_vec())));
            }
        }
        Ok(None)
    }
    pub fn lookup_lpm_v6(&self, ip: std::net::Ipv6Addr) -> sled::Result<Option<(u8, Vec<u8>)>> {
        let ip_u128 = u128::from_be_bytes(ip.octets());
        for len in (0..=128).rev() {
            let mask = if len == 0 {
                0
            } else if len == 128 {
                u128::MAX
            } else {
                !((1u128 << (128 - len)) - 1)
            };
            let masked_ip = std::net::Ipv6Addr::from(ip_u128 & mask);
            let key = Self::make_key_v6(masked_ip, len as u8);
            if let Some(val) = self.tree.get(key)? {
                return Ok(Some((len as u8, val.to_vec())));
            }
        }
        Ok(None)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ClassificationType {
    None = 0,
    Bogon = 1,
    Hijack = 2,
    RouteLeak = 3,
    MinorRouteLeak = 10,
    Outage = 4,
    DDoSMitigation = 5,
    Flap = 6,
    PathHunting = 8,
    Discovery = 9,
}

impl ClassificationType {
    pub fn from_i32(val: i32) -> Self {
        match val {
            1 => ClassificationType::Bogon,
            2 => ClassificationType::Hijack,
            3 => ClassificationType::RouteLeak,
            10 => ClassificationType::MinorRouteLeak,
            4 => ClassificationType::Outage,
            5 => ClassificationType::DDoSMitigation,
            6 => ClassificationType::Flap,
            8 => ClassificationType::PathHunting,
            9 => ClassificationType::Discovery,
            _ => ClassificationType::None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LeakType {
    None = 0,
    ReOrigination = 1,
    Hairpin = 2,
    Lateral = 3,
    Flowspec = 4,
    RTBH = 5,
    TrafficRedirection = 6,
    ValleyFreeViolation = 7,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakDetail {
    pub leak_type: LeakType,
    pub leaker_asn: u32,
    pub victim_asn: u32,
    #[serde(default)]
    pub leaker_as_name: String,
    #[serde(default)]
    pub victim_as_name: String,
    pub leaker_rpki_status: i32,
    pub victim_rpki_status: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AnomalyDetails {
    pub num_collectors: usize,
    pub num_peers: usize,
    pub num_withdrawals: u32,
    pub num_announcements: u32,
    pub flap_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StatsBucket {
    pub announcements: u32,
    pub withdrawals: u32,
    pub total_messages: u32,
    pub path_changes: u32,
    pub community_changes: u32,
    pub next_hop_changes: u32,
    pub aggregator_changes: u32,
    pub med_changes: u32,
    pub local_pref_changes: u32,
    pub path_length_increases: u32,
    pub path_length_decreases: u32,
    pub flaps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastAttrs {
    pub path: String,
    pub communities: String,
    pub next_hop: String,
    pub aggregator: String,
    pub last_path_len: i32,
    pub origin_asn: u32,
    pub med: Option<u32>,
    pub local_pref: Option<u32>,
    pub last_update_ts: i64,
    pub host: String,
    pub withdrawn: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrefixState {
    pub peer_last_attrs: HashMap<String, LastAttrs>,
    pub buckets: HashMap<i64, StatsBucket>,
    pub start_time_ts: i64,
    pub last_update_ts: i64,
    pub last_rpki_status: i32,
    pub last_origin_asn: u32,
    pub historical_origin_asn: u32,
    pub classified_type: ClassificationType,
    pub classified_time_ts: i64,
    pub leak_type: LeakType,
    pub leaker_asn: u32,
    pub victim_asn: u32,
    pub fully_withdrawn_ts: Option<i64>,
    pub uncategorized_counted: bool,
    pub active_incident_id: Option<String>,
    pub lat: f32,
    pub lon: f32,
    pub city: Option<String>,
    pub country: Option<String>,
}

impl Default for PrefixState {
    fn default() -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        Self {
            peer_last_attrs: HashMap::new(),
            buckets: HashMap::new(),
            start_time_ts: now,
            last_update_ts: now,
            last_rpki_status: 0,
            last_origin_asn: 0,
            historical_origin_asn: 0,
            classified_type: ClassificationType::None,
            classified_time_ts: 0,
            leak_type: LeakType::None,
            leaker_asn: 0,
            victim_asn: 0,
            fully_withdrawn_ts: None,
            uncategorized_counted: false,
            active_incident_id: None,
            lat: 0.0,
            lon: 0.0,
            city: None,
            country: None,
        }
    }
}

pub struct MessageContext {
    pub now: i64,
    pub host: String,
    pub peer: String,
    pub is_withdrawal: bool,
    pub path_str: String,
    pub comm_str: String,
    pub origin_asn: u32,
    pub path_len: usize,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEvent {
    pub prefix: String,
    pub asn: u32,
    pub as_name: String,
    pub peer_ip: String,
    pub historical_asn: u32,
    pub timestamp: i64,
    pub classification_type: ClassificationType,
    pub old_classification: ClassificationType,
    pub incident_id: Option<String>,
    pub incident_start_time: i64,
    pub leak_detail: Option<LeakDetail>,
    pub anomaly_details: Option<AnomalyDetails>,
    pub source: String,
    pub lat: f32,
    pub lon: f32,
    pub city: Option<String>,
    pub country: Option<String>,
}

#[derive(Default)]
pub struct BgpkitCache {
    pub as2org: HashMap<u32, Option<String>>,
    pub as2name: HashMap<u32, Option<String>>,
}

pub struct Classifier {
    pub shards: Vec<Mutex<LruCache<String, PrefixState>>>,
    pub seen_db: Option<DiskTrie>,
    pub state_db: Option<Arc<Db>>,
    pub bgpkit: RwLock<Option<bgpkit_commons::BgpkitCommons>>,
    pub bgpkit_cache: Mutex<BgpkitCache>,
    pub provider_db: Mutex<HashMap<u32, HashSet<u32>>>,
}

pub struct AggregatedStats {
    pub earliest_ts: i64,
    pub total_ann: u32,
    pub total_with: u32,
    pub total_msgs: u32,
    pub path_changes: u32,
    pub path_len_inc: u32,
    pub path_len_dec: u32,
    pub total_flaps: u32,
    pub unique_peers: HashSet<String>,
    pub unique_hosts: HashSet<String>,
    pub all_unique_hosts: HashSet<String>,
    pub withdrawn_peers: HashSet<String>,
    pub peer_attrs_values: Vec<LastAttrs>,
}

impl AggregatedStats {
    fn new(now: i64) -> Self {
        Self {
            earliest_ts: now,
            total_ann: 0,
            total_with: 0,
            total_msgs: 0,
            path_changes: 0,
            path_len_inc: 0,
            path_len_dec: 0,
            total_flaps: 0,
            unique_peers: HashSet::new(),
            unique_hosts: HashSet::new(),
            all_unique_hosts: HashSet::new(),
            withdrawn_peers: HashSet::new(),
            peer_attrs_values: Vec::new(),
        }
    }
}

impl Classifier {
    pub fn new(capacity: usize, seen_db: Option<DiskTrie>, state_db: Option<Arc<Db>>) -> Self {
        let num_shards = 16;
        let shard_capacity = (capacity / num_shards).max(1);
        let mut shards = Vec::with_capacity(num_shards);
        for _ in 0..num_shards {
            shards.push(Mutex::new(LruCache::new(
                NonZeroUsize::new(shard_capacity).unwrap(),
            )));
        }
        Self {
            shards,
            seen_db,
            state_db,
            bgpkit: RwLock::new(None),
            bgpkit_cache: Mutex::new(BgpkitCache::default()),
            provider_db: Mutex::new(HashMap::new()),
        }
    }

    fn get_shard(&self, prefix: &str) -> &Mutex<LruCache<String, PrefixState>> {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        prefix.hash(&mut hasher);
        let index = (hasher.finish() as usize) % self.shards.len();
        &self.shards[index]
    }

    pub fn classify_event(
        &self,
        prefix: String,
        ctx: &MessageContext,
        lat: f32,
        lon: f32,
        city: Option<String>,
        country: Option<String>,
    ) -> (Option<PendingEvent>, bool) {
        let shard = self.get_shard(&prefix);

        let mut state_opt = {
            let mut states = shard.lock();
            states.get(&prefix).cloned()
        };

        if state_opt.is_none()
            && let Some(ref db) = self.state_db
            && let Some(data) = db.get_prefix_state(&prefix)
        {
            state_opt = serde_json::from_str(&data).ok();
        }

        let mut historical_origin_asn = 0;
        if let Some(s) = &state_opt {
            historical_origin_asn = s.historical_origin_asn;
        }

        if historical_origin_asn == 0 {
            historical_origin_asn = self.get_historical_asn(&prefix);
        }

        let mut states = shard.lock();
        let mut state = if let Some(s) = states.get(&prefix) {
            s.clone()
        } else {
            state_opt.unwrap_or_default()
        };

        if state.historical_origin_asn == 0 {
            state.historical_origin_asn = historical_origin_asn;
        } else {
            historical_origin_asn = state.historical_origin_asn;
        }

        let old_classified_type = state.classified_type;
        state.last_update_ts = ctx.now;
        let minute_ts = (ctx.now / 60) * 60;
        state.buckets.retain(|&ts, _| ts >= ctx.now - 600);
        state
            .peer_last_attrs
            .retain(|_, attr| !attr.withdrawn || attr.last_update_ts >= ctx.now - 3600);
        state.buckets.entry(minute_ts).or_default().total_messages += 1;

        if ctx.is_withdrawal {
            state.buckets.entry(minute_ts).or_default().withdrawals += 1;
            let session_key = format!("{}:{}", ctx.host, ctx.peer);
            if let Some(last) = state.peer_last_attrs.get_mut(&session_key) {
                if !last.withdrawn {
                    state.buckets.entry(minute_ts).or_default().flaps += 1;
                }
                last.withdrawn = true;
                last.last_update_ts = ctx.now;
            } else {
                state.peer_last_attrs.insert(
                    session_key,
                    LastAttrs {
                        path: String::new(),
                        communities: String::new(),
                        next_hop: String::new(),
                        aggregator: String::new(),
                        last_path_len: 0,
                        origin_asn: 0,
                        med: None,
                        local_pref: None,
                        last_update_ts: ctx.now,
                        host: ctx.host.clone(),
                        withdrawn: true,
                    },
                );
            }
            if state.classified_type == ClassificationType::Outage {
                state.classified_time_ts = ctx.now;
            }
        } else {
            self.update_announcement_stats(&mut state, minute_ts, ctx);
            if ctx.origin_asn != 0 {
                state.last_origin_asn = ctx.origin_asn;
                if let Some(ref db) = self.state_db
                    && let Ok(net) = IpNet::from_str(&prefix)
                    && historical_origin_asn == 0
                {
                    db.record_seen(net, ctx.origin_asn);
                }
            }
        }

        if state.classified_type != ClassificationType::None {
            let expiry = match state.classified_type {
                ClassificationType::Outage => 1800,
                ClassificationType::Flap => 60,
                _ => 600,
            };
            if ctx.now - state.classified_time_ts > expiry
                || (state.classified_type == ClassificationType::Outage && !ctx.is_withdrawal)
            {
                state.classified_type = ClassificationType::None;
            }
        }

        if !ctx.is_withdrawal {
            let path = self.parse_path(&ctx.path_str);
            self.update_provider_info(&path);
        }

        let resolved_asn = if ctx.origin_asn != 0 {
            ctx.origin_asn
        } else if state.last_origin_asn != 0 {
            state.last_origin_asn
        } else {
            historical_origin_asn
        };
        state.lat = lat;
        state.lon = lon;
        state.city = city.clone();
        state.country = country.clone();

        let (mut result, needs_timer) = self.evaluate_prefix_state(
            &prefix,
            &mut state,
            historical_origin_asn,
            resolved_asn,
            ctx,
            lat,
            lon,
            city.clone(),
            country.clone(),
            old_classified_type,
        );

        if result.is_none() && state.classified_type != old_classified_type {
            result = Some(PendingEvent {
                prefix: prefix.clone(),
                asn: resolved_asn,
                as_name: self.get_as_name(resolved_asn).unwrap_or_default(),
                peer_ip: ctx.peer.clone(),
                historical_asn: historical_origin_asn,
                timestamp: ctx.now,
                classification_type: state.classified_type,
                old_classification: old_classified_type,
                incident_id: state.active_incident_id.clone(),
                incident_start_time: state.classified_time_ts,
                leak_detail: if state.leak_type != LeakType::None {
                    Some(LeakDetail {
                        leak_type: state.leak_type,
                        leaker_asn: state.leaker_asn,
                        victim_asn: state.victim_asn,
                        leaker_as_name: self.get_as_name(state.leaker_asn).unwrap_or_default(),
                        victim_as_name: self.get_as_name(state.victim_asn).unwrap_or_default(),
                        leaker_rpki_status: self.rpki_validate(state.leaker_asn, &prefix),
                        victim_rpki_status: self.rpki_validate(state.victim_asn, &prefix),
                    })
                } else {
                    None
                },
                anomaly_details: None,
                source: ctx.source.clone(),
                lat,
                lon,
                city: city.clone(),
                country: country.clone(),
            });
            if state.classified_type == ClassificationType::None {
                state.active_incident_id = None;
            }
        } else if result.is_none() && state.classified_type != ClassificationType::None {
            let emitted_classification = if state.classified_type == ClassificationType::RouteLeak || state.classified_type == ClassificationType::MinorRouteLeak || state.classified_type == ClassificationType::Hijack {
                ClassificationType::Discovery
            } else {
                state.classified_type
            };

            result = Some(PendingEvent {
                prefix: prefix.clone(),
                asn: resolved_asn,
                as_name: self.get_as_name(resolved_asn).unwrap_or_default(),
                peer_ip: ctx.peer.clone(),
                historical_asn: historical_origin_asn,
                timestamp: ctx.now,
                classification_type: emitted_classification,
                old_classification: emitted_classification,
                incident_id: state.active_incident_id.clone(),
                incident_start_time: state.classified_time_ts,
                leak_detail: if state.leak_type != LeakType::None {
                    Some(LeakDetail {
                        leak_type: state.leak_type,
                        leaker_asn: state.leaker_asn,
                        victim_asn: state.victim_asn,
                        leaker_as_name: self.get_as_name(state.leaker_asn).unwrap_or_default(),
                        victim_as_name: self.get_as_name(state.victim_asn).unwrap_or_default(),
                        leaker_rpki_status: self.rpki_validate(state.leaker_asn, &prefix),
                        victim_rpki_status: self.rpki_validate(state.victim_asn, &prefix),
                    })
                } else {
                    None
                },
                anomaly_details: None,
                source: ctx.source.clone(),
                lat,
                lon,
                city: city.clone(),
                country: country.clone(),
            });
        }

        if result.is_none() && !ctx.is_withdrawal && historical_origin_asn == 0 {
            result = Some(PendingEvent {
                prefix: prefix.clone(),
                asn: resolved_asn,
                as_name: self.get_as_name(resolved_asn).unwrap_or_default(),
                peer_ip: ctx.peer.clone(),
                historical_asn: 0,
                timestamp: ctx.now,
                classification_type: ClassificationType::Discovery,
                old_classification: ClassificationType::None,
                incident_id: state.active_incident_id.clone(),
                incident_start_time: state.classified_time_ts,
                leak_detail: None,
                anomaly_details: None,
                source: ctx.source.clone(),
                lat,
                lon,
                city: city.clone(),
                country: country.clone(),
            });
            if let Some(ref db) = self.state_db
                && let Ok(net) = IpNet::from_str(&prefix)
                && historical_origin_asn == 0
            {
                db.record_seen(net, ctx.origin_asn);
            }
        }

        if let Some(ref db) = self.state_db {
            let has_active = state.peer_last_attrs.values().any(|attr| !attr.withdrawn);
            if !has_active && ctx.now - state.last_update_ts > 86400 {
                db.delete_prefix(&prefix);
            } else if (ctx.is_withdrawal || state.classified_type != old_classified_type)
                && let Ok(data) = serde_json::to_string(&state)
            {
                let p_asn = if ctx.origin_asn != 0 {
                    ctx.origin_asn
                } else if state.last_origin_asn != 0 {
                    state.last_origin_asn
                } else {
                    state.historical_origin_asn
                };
                db.upsert_prefix_state(
                    &prefix,
                    &data,
                    state.last_update_ts,
                    state.classified_type as i32,
                    p_asn,
                );
            }
        }
        states.put(prefix, state);
        (result, needs_timer)
    }

    #[allow(clippy::too_many_arguments)]
    fn evaluate_prefix_state(
        &self,
        prefix: &str,
        state: &mut PrefixState,
        historical_origin_asn: u32,
        resolved_asn: u32,
        ctx: &MessageContext,
        lat: f32,
        lon: f32,
        city: Option<String>,
        country: Option<String>,
        old_classified_type: ClassificationType,
    ) -> (Option<PendingEvent>, bool) {
        let stats = self.aggregate_recent_buckets(state, ctx.now, ctx.origin_asn);
        let elapsed = (ctx.now - stats.earliest_ts).max(1);

        if stats.unique_peers.is_empty() {
            if state.fully_withdrawn_ts.is_none() {
                state.fully_withdrawn_ts = Some(ctx.now);
            }
        } else {
            state.fully_withdrawn_ts = None;
        }

        let fw_ts = state.fully_withdrawn_ts;

        let (event_opt, needs_timer) = self.find_critical_anomaly(
            prefix,
            &stats,
            elapsed as f64,
            ctx,
            historical_origin_asn,
            resolved_asn,
            lat,
            lon,
            city.clone(),
            country.clone(),
            fw_ts,
        );

        if let Some(mut event) = event_opt {
            let is_new_broad = matches!(
                event.classification_type,
                ClassificationType::DDoSMitigation
                    | ClassificationType::Discovery
                    | ClassificationType::PathHunting
            );
            let is_old_specific = matches!(
                old_classified_type,
                ClassificationType::Hijack
                    | ClassificationType::Outage
                    | ClassificationType::RouteLeak
                    | ClassificationType::MinorRouteLeak
                    | ClassificationType::Flap
            );
            if is_new_broad && is_old_specific && (ctx.now - state.classified_time_ts < 300) {
                return (None, needs_timer);
            }
            event.old_classification = old_classified_type;
            let is_new_bad = matches!(
                event.classification_type,
                ClassificationType::Hijack
                    | ClassificationType::RouteLeak
                    | ClassificationType::MinorRouteLeak
                    | ClassificationType::Outage
                    | ClassificationType::Flap
            );
            let is_old_bad = matches!(
                old_classified_type,
                ClassificationType::Hijack
                    | ClassificationType::RouteLeak
                    | ClassificationType::MinorRouteLeak
                    | ClassificationType::Outage
                    | ClassificationType::Flap
            );
            if is_new_bad && !is_old_bad {
                state.active_incident_id = Some(uuid::Uuid::new_v4().to_string());
                event.incident_id = state.active_incident_id.clone();
                event.incident_start_time = ctx.now;
            } else if !is_new_bad && is_old_bad {
                event.incident_id = state.active_incident_id.clone();
                event.incident_start_time = state.classified_time_ts;
                state.active_incident_id = None;
            } else if is_new_bad && is_old_bad && old_classified_type != event.classification_type {
                state.active_incident_id = Some(uuid::Uuid::new_v4().to_string());
                event.incident_id = state.active_incident_id.clone();
                event.incident_start_time = ctx.now;
            } else {
                event.incident_id = state.active_incident_id.clone();
                event.incident_start_time = if state.classified_time_ts == 0 {
                    ctx.now
                } else {
                    state.classified_time_ts
                };
            }
            state.classified_type = event.classification_type;
            state.classified_time_ts = ctx.now;
            if let Some(ref ld) = event.leak_detail {
                state.leak_type = ld.leak_type;
                state.leaker_asn = ld.leaker_asn;
                state.victim_asn = ld.victim_asn;
            }
            return (Some(event), needs_timer);
        }
        (None, needs_timer)
    }

    #[allow(clippy::too_many_arguments)]
    fn find_critical_anomaly(
        &self,
        prefix: &str,
        s: &AggregatedStats,
        elapsed: f64,
        ctx: &MessageContext,
        historical_origin_asn: u32,
        resolved_asn: u32,
        lat: f32,
        lon: f32,
        city: Option<String>,
        country: Option<String>,
        fully_withdrawn_ts: Option<i64>,
    ) -> (Option<PendingEvent>, bool) {
        let as_name = self.get_as_name(resolved_asn).unwrap_or_default();
        if self.is_bogon(prefix, ctx) {
            return (
                Some(PendingEvent {
                    prefix: prefix.to_string(),
                    asn: resolved_asn,
                    as_name,
                    peer_ip: ctx.peer.clone(),
                    historical_asn: historical_origin_asn,
                    timestamp: ctx.now,
                    classification_type: ClassificationType::Bogon,
                    old_classification: ClassificationType::None,
                    incident_id: None,
                    incident_start_time: 0,
                    leak_detail: None,
                    anomaly_details: None,
                    source: ctx.source.clone(),
                    lat,
                    lon,
                    city: city.clone(),
                    country: country.clone(),
                }),
                false,
            );
        }
        if historical_origin_asn != 0
            && ctx.origin_asn != 0
            && ctx.origin_asn != historical_origin_asn
            && !self.is_likely_sibling(ctx.origin_asn, historical_origin_asn)
        {
            if self.rpki_validate(ctx.origin_asn, prefix) == 1 {
                return (None, false);
            }
            let mut hosts = HashSet::new();
            for attr in &s.peer_attrs_values {
                if !attr.withdrawn && attr.origin_asn == ctx.origin_asn {
                    hosts.insert(attr.host.clone());
                }
            }
            if !s.unique_hosts.contains(&ctx.host) {
                hosts.insert(ctx.host.clone());
            }
            if hosts.len() >= 5 {
                return (
                    Some(PendingEvent {
                        prefix: prefix.to_string(),
                        asn: resolved_asn,
                        as_name,
                        peer_ip: ctx.peer.clone(),
                        historical_asn: historical_origin_asn,
                        timestamp: ctx.now,
                        classification_type: ClassificationType::Hijack,
                        old_classification: ClassificationType::None,
                        incident_id: None,
                        incident_start_time: 0,
                        leak_detail: Some(LeakDetail {
                            leak_type: LeakType::None,
                            leaker_asn: ctx.origin_asn,
                            victim_asn: historical_origin_asn,
                            leaker_as_name: self.get_as_name(ctx.origin_asn).unwrap_or_default(),
                            victim_as_name: self
                                .get_as_name(historical_origin_asn)
                                .unwrap_or_default(),
                            leaker_rpki_status: self.rpki_validate(ctx.origin_asn, prefix),
                            victim_rpki_status: self.rpki_validate(historical_origin_asn, prefix),
                        }),
                        anomaly_details: None,
                        source: ctx.source.clone(),
                        lat,
                        lon,
                        city: city.clone(),
                        country: country.clone(),
                    }),
                    false,
                );
            }
        }
        let total_known = s.unique_peers.len() + s.withdrawn_peers.len();
        if total_known >= 3
            && s.unique_peers.is_empty()
            && elapsed > 30.0
            && resolved_asn != 0
            && let Some(fw_ts) = fully_withdrawn_ts
        {
            if ctx.now - fw_ts >= 10 {
                return (
                    Some(PendingEvent {
                        prefix: prefix.to_string(),
                        asn: resolved_asn,
                        as_name,
                        peer_ip: ctx.peer.clone(),
                        historical_asn: historical_origin_asn,
                        timestamp: ctx.now,
                        classification_type: ClassificationType::Outage,
                        old_classification: ClassificationType::None,
                        incident_id: None,
                        incident_start_time: 0,
                        leak_detail: None,
                        anomaly_details: Some(AnomalyDetails {
                            num_collectors: s.unique_hosts.len(),
                            num_peers: s.withdrawn_peers.len(),
                            num_withdrawals: s.total_with,
                            ..Default::default()
                        }),
                        source: ctx.source.clone(),
                        lat,
                        lon,
                        city: city.clone(),
                        country: country.clone(),
                    }),
                    false,
                );
            } else {
                return (None, true);
            }
        }
        if s.unique_hosts.len() >= 2
            && let Some(ld) = self.detect_route_leak(prefix, ctx)
        {
            let classification = if s.unique_hosts.len() >= 5 {
                ClassificationType::RouteLeak
            } else {
                ClassificationType::MinorRouteLeak
            };
            return (
                Some(PendingEvent {
                    prefix: prefix.to_string(),
                    asn: resolved_asn,
                    as_name,
                    peer_ip: ctx.peer.clone(),
                    historical_asn: historical_origin_asn,
                    timestamp: ctx.now,
                    classification_type: classification,
                    old_classification: ClassificationType::None,
                    incident_id: None,
                    incident_start_time: 0,
                    leak_detail: Some(ld),
                    anomaly_details: None,
                    source: ctx.source.clone(),
                    lat,
                    lon,
                    city: city.clone(),
                    country: country.clone(),
                }),
                false,
            );
        }
        if s.unique_hosts.len() >= 2 && s.path_len_inc >= 2 && s.path_changes >= 3 {
            return (
                Some(PendingEvent {
                    prefix: prefix.to_string(),
                    asn: resolved_asn,
                    as_name,
                    peer_ip: ctx.peer.clone(),
                    historical_asn: historical_origin_asn,
                    timestamp: ctx.now,
                    classification_type: ClassificationType::PathHunting,
                    old_classification: ClassificationType::None,
                    incident_id: None,
                    incident_start_time: 0,
                    leak_detail: None,
                    anomaly_details: None,
                    source: ctx.source.clone(),
                    lat,
                    lon,
                    city: city.clone(),
                    country: country.clone(),
                }),
                false,
            );
        }
        if s.all_unique_hosts.len() >= 2 && s.total_flaps >= 3 {
            return (
                Some(PendingEvent {
                    prefix: prefix.to_string(),
                    asn: resolved_asn,
                    as_name,
                    peer_ip: ctx.peer.clone(),
                    historical_asn: historical_origin_asn,
                    timestamp: ctx.now,
                    classification_type: ClassificationType::Flap,
                    old_classification: ClassificationType::None,
                    incident_id: None,
                    incident_start_time: 0,
                    leak_detail: None,
                    anomaly_details: Some(AnomalyDetails {
                        num_collectors: s.all_unique_hosts.len(),
                        num_peers: s.unique_peers.len() + s.withdrawn_peers.len(),
                        num_withdrawals: s.total_with,
                        num_announcements: s.total_ann,
                        flap_count: s.total_flaps as usize,
                    }),
                    source: ctx.source.clone(),
                    lat,
                    lon,
                    city: city.clone(),
                    country: country.clone(),
                }),
                false,
            );
        }
        if s.unique_hosts.len() >= 3 && self.is_ddos_mitigation(ctx) {
            return (
                Some(PendingEvent {
                    prefix: prefix.to_string(),
                    asn: resolved_asn,
                    as_name,
                    peer_ip: ctx.peer.clone(),
                    historical_asn: historical_origin_asn,
                    timestamp: ctx.now,
                    classification_type: ClassificationType::DDoSMitigation,
                    old_classification: ClassificationType::None,
                    incident_id: None,
                    incident_start_time: 0,
                    leak_detail: None,
                    anomaly_details: None,
                    source: ctx.source.clone(),
                    lat,
                    lon,
                    city: city.clone(),
                    country: country.clone(),
                }),
                false,
            );
        }
        (None, false)
    }

    fn aggregate_recent_buckets(
        &self,
        state: &mut PrefixState,
        now: i64,
        current_origin_asn: u32,
    ) -> AggregatedStats {
        let mut s = AggregatedStats::new(now);
        let cutoff = now - 600;
        for (&ts, b) in &state.buckets {
            if ts < cutoff {
                continue;
            }
            if ts < s.earliest_ts {
                s.earliest_ts = ts;
            }
            s.total_ann += b.announcements;
            s.total_with += b.withdrawals;
            s.total_msgs += b.total_messages;
            s.path_changes += b.path_changes;
            s.path_len_inc += b.path_length_increases;
            s.path_len_dec += b.path_length_decreases;
            s.total_flaps += b.flaps;
        }
        for (peer, attr) in &state.peer_last_attrs {
            s.peer_attrs_values.push(attr.clone());
            s.all_unique_hosts.insert(attr.host.clone());
            if attr.withdrawn {
                s.withdrawn_peers.insert(peer.clone());
            } else if attr.origin_asn == current_origin_asn {
                s.unique_peers.insert(peer.clone());
                s.unique_hosts.insert(attr.host.clone());
            }
        }
        s
    }

    fn update_announcement_stats(
        &self,
        state: &mut PrefixState,
        minute_ts: i64,
        ctx: &MessageContext,
    ) {
        let session_key = format!("{}:{}", ctx.host, ctx.peer);
        let (path_changed, len_inc, len_dec, was_withdrawn) =
            if let Some(last) = state.peer_last_attrs.get(&session_key) {
                let pc = last.path != ctx.path_str;
                let inc = if pc && ctx.path_len > last.last_path_len as usize {
                    1
                } else {
                    0
                };
                let dec = if pc && ctx.path_len < last.last_path_len as usize {
                    1
                } else {
                    0
                };
                (pc, inc, dec, last.withdrawn)
            } else {
                (true, 0, 0, false)
            };
        let bucket = state.buckets.entry(minute_ts).or_default();
        bucket.announcements += 1;
        if was_withdrawn {
            bucket.flaps += 1;
        }
        if path_changed {
            bucket.path_changes += 1;
            bucket.path_length_increases += len_inc;
            bucket.path_length_decreases += len_dec;
        }
        state.peer_last_attrs.insert(
            session_key,
            LastAttrs {
                path: ctx.path_str.clone(),
                communities: ctx.comm_str.clone(),
                next_hop: String::new(),
                aggregator: String::new(),
                last_path_len: ctx.path_len as i32,
                origin_asn: ctx.origin_asn,
                med: None,
                local_pref: None,
                last_update_ts: ctx.now,
                host: ctx.host.clone(),
                withdrawn: false,
            },
        );
    }

    fn get_historical_asn(&self, prefix: &str) -> u32 {
        if let Some(ref seen_db) = self.seen_db
            && let Ok(net) = IpNet::from_str(prefix)
        {
            match net.addr() {
                IpAddr::V4(v4) => {
                    if let Ok(Some((_, val))) = seen_db.lookup_lpm_v4(v4)
                        && val.len() == 4
                    {
                        return u32::from_be_bytes(val.try_into().unwrap());
                    }
                }
                IpAddr::V6(v6) => {
                    if let Ok(Some((_, val))) = seen_db.lookup_lpm_v6(v6)
                        && val.len() == 4
                    {
                        return u32::from_be_bytes(val.try_into().unwrap());
                    }
                }
            }
        }
        0
    }

    fn is_bogon(&self, prefix: &str, _ctx: &MessageContext) -> bool {
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard
            && let Ok(is_bogon) = bgpkit.bogons_match(prefix)
        {
            return is_bogon;
        }

        // Fallback local checks if bogons list is not loaded or missing
        if let Ok(net) = IpNet::from_str(prefix) {
            let addr = net.addr();
            if addr.is_loopback() || addr.is_multicast() || addr.is_unspecified() {
                return true;
            }
            if let IpAddr::V4(v4) = addr {
                if v4.is_private() || v4.is_link_local() {
                    return true;
                }
                let o = v4.octets();
                if (o[0] == 100 && (o[1] & 0b11000000) == 64)
                    || (o[0] == 192 && o[1] == 0 && o[2] == 2)
                    || (o[0] == 198 && o[1] == 51 && o[2] == 100)
                    || (o[0] == 203 && o[1] == 0 && o[2] == 113)
                {
                    return true;
                }
            } else if let IpAddr::V6(v6) = addr
                && v6.is_unicast_link_local()
            {
                return true;
            }
        }

        false
    }

    #[allow(dead_code)]
    fn is_provider(&self, provider: u32, customer: u32) -> bool {
        let db = self.provider_db.lock();
        if let Some(customers) = db.get(&provider)
            && customers.contains(&customer)
        {
            return true;
        }
        false
    }

    fn update_provider_info(&self, path: &[u32]) {
        if path.len() < 2 {
            return;
        }
        let mut db = self.provider_db.lock();
        for i in 0..path.len() - 1 {
            let p = path[i];
            let c = path[i + 1];
            if self.is_tier1(p) || self.is_large_network(p) {
                db.entry(p).or_default().insert(c);
            }
        }
    }

    fn detect_route_leak(&self, prefix: &str, ctx: &MessageContext) -> Option<LeakDetail> {
        let path = self.parse_path(&ctx.path_str);
        if path.len() < 3 {
            return None;
        }

        // 1. Valley-Free Violation: Customer to Provider to Provider/Peer
        for i in 0..path.len() - 2 {
            let (p1, p2, p3) = (path[i], path[i + 1], path[i + 2]);
            if (self.is_tier1(p1) || self.is_large_network(p1))
                && !self.is_tier1(p2)
                && (self.is_tier1(p3) || self.is_large_network(p3))
                && p1 != p3
                && p1 != p2
                && p2 != p3
            {
                return Some(LeakDetail {
                    leak_type: LeakType::ValleyFreeViolation, // Renamed from Hairpin since Hairpin is specifically when routing goes back to the same network
                    leaker_asn: p2,
                    victim_asn: p3,
                    leaker_as_name: self.get_as_name(p2).unwrap_or_default(),
                    victim_as_name: self.get_as_name(p3).unwrap_or_default(),
                    leaker_rpki_status: self.rpki_validate(p2, prefix),
                    victim_rpki_status: self.rpki_validate(p3, prefix),
                });
            }
        }

        // 2. Hairpin Turn: Route goes A -> B -> A
        for i in 0..path.len() - 2 {
            let (p1, p2, p3) = (path[i], path[i + 1], path[i + 2]);
            if p1 == p3 && p1 != p2 {
                return Some(LeakDetail {
                    leak_type: LeakType::Hairpin,
                    leaker_asn: p2,
                    victim_asn: p1,
                    leaker_as_name: self.get_as_name(p2).unwrap_or_default(),
                    victim_as_name: self.get_as_name(p1).unwrap_or_default(),
                    leaker_rpki_status: self.rpki_validate(p2, prefix),
                    victim_rpki_status: self.rpki_validate(p1, prefix),
                });
            }
        }

        None
    }

    fn is_ddos_mitigation(&self, ctx: &MessageContext) -> bool {
        for comm in ctx.comm_str.split_whitespace() {
            if comm == "65535:666" || comm.ends_with(":666") {
                return true;
            }
        }
        false
    }
    fn is_likely_sibling(&self, asn1: u32, asn2: u32) -> bool {
        if asn1 == asn2 {
            return true;
        }

        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard
            && let Ok(are_siblings) = bgpkit.asinfo_are_siblings(asn1, asn2)
            && are_siblings
        {
            return true;
        }

        if let (Some(o1), Some(o2)) = (self.get_as_org(asn1), self.get_as_org(asn2))
            && o1 == o2
        {
            return true;
        }
        if let (Some(n1), Some(n2)) = (self.get_as_name(asn1), self.get_as_name(asn2)) {
            let (n1l, n2l) = (n1.to_lowercase(), n2.to_lowercase());
            let common = [
                "china telecom",
                "chinanet",
                "google",
                "cloudflare",
                "amazon",
                "akamai",
            ];
            for c in common {
                if n1l.contains(c) && n2l.contains(c) {
                    return true;
                }
            }
        }
        false
    }

    fn is_tier1(&self, asn: u32) -> bool {
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard
            && let Ok(Some(info)) = bgpkit.asinfo_get(asn)
            && let Some(hegemony) = info.hegemony
            && (hegemony.ipv4 > 0.05 || hegemony.ipv6 > 0.05)
        {
            return true;
        }
        matches!(
            asn,
            174 | 209
                | 701
                | 1239
                | 1299
                | 2828
                | 2914
                | 3257
                | 3320
                | 3356
                | 3549
                | 3561
                | 5511
                | 6453
                | 6461
                | 6762
                | 7018
                | 12956
        )
    }

    fn is_large_network(&self, asn: u32) -> bool {
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard
            && let Ok(Some(info)) = bgpkit.asinfo_get(asn)
        {
            if let Some(pop) = info.population
                && (pop.percent_global > 0.01 || pop.user_count > 10_000_000)
            {
                return true;
            }
            if let Some(hegemony) = info.hegemony
                && (hegemony.ipv4 > 0.01 || hegemony.ipv6 > 0.01)
            {
                return true;
            }
        }
        matches!(
            asn,
            15169 | 16509 | 8075 | 13335 | 20940 | 14618 | 32934 | 16276
        )
    }

    pub fn get_as_name(&self, asn: u32) -> Option<String> {
        if asn == 0 {
            return None;
        }
        {
            let cache = self.bgpkit_cache.lock();
            if let Some(res) = cache.as2name.get(&asn) {
                return res.clone();
            }
        }
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard {
            let name = bgpkit.asinfo_get(asn).ok().flatten().and_then(|i| {
                if !i.name.is_empty() {
                    Some(i.name)
                } else if let Some(org) = i.as2org {
                    Some(org.org_name)
                } else {
                    None
                }
            });

            if name.is_none() {
                debug!("AS name not found for AS{}", asn);
            }

            if name.is_some() {
                let mut cache = self.bgpkit_cache.lock();
                cache.as2name.insert(asn, name.clone());
            }
            return name;
        }
        None
    }

    fn get_as_org(&self, asn: u32) -> Option<String> {
        {
            let cache = self.bgpkit_cache.lock();
            if let Some(res) = cache.as2org.get(&asn) {
                return res.clone();
            }
        }
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard {
            let org = bgpkit
                .asinfo_get(asn)
                .ok()
                .flatten()
                .and_then(|i| i.as2org.clone().map(|o| o.org_name));
            if org.is_some() {
                let mut cache = self.bgpkit_cache.lock();
                cache.as2org.insert(asn, org.clone());
            }
            return org;
        }
        None
    }

    fn parse_path(&self, path_str: &str) -> Vec<u32> {
        let mut path: Vec<u32> = path_str
            .split_whitespace()
            .filter_map(|s| s.parse().ok())
            .collect();
        path.dedup();
        path
    }

    fn rpki_validate(&self, asn: u32, prefix: &str) -> i32 {
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard
            && let Ok(status) = bgpkit.rpki_validate(asn, prefix)
        {
            return match status {
                bgpkit_commons::rpki::RpkiValidation::Valid => 1,
                bgpkit_commons::rpki::RpkiValidation::Invalid => 2,
                bgpkit_commons::rpki::RpkiValidation::Unknown => 3,
            };
        }
        0
    }

    pub fn check_outage(&self, prefix: &str, now: i64) -> Option<PendingEvent> {
        let shard = self.get_shard(prefix);
        let mut state_opt = None;
        {
            let mut states = shard.lock();
            if let Some(s) = states.get(prefix) {
                state_opt = Some(s.clone());
            }
        }

        let mut state = state_opt?;

        if let Some(fw_ts) = state.fully_withdrawn_ts
            && now - fw_ts >= 10
            && state.classified_type != ClassificationType::Outage
        {
            state.classified_type = ClassificationType::Outage;
            state.classified_time_ts = now;
            if state.active_incident_id.is_none() {
                state.active_incident_id = Some(uuid::Uuid::new_v4().to_string());
            }

            let resolved_asn = if state.last_origin_asn != 0 {
                state.last_origin_asn
            } else {
                state.historical_origin_asn
            };

            let s = self.aggregate_recent_buckets(&mut state, now, resolved_asn);

            let event = PendingEvent {
                prefix: prefix.to_string(),
                asn: resolved_asn,
                as_name: self.get_as_name(resolved_asn).unwrap_or_default(),
                peer_ip: "synthetic".to_string(),
                historical_asn: state.historical_origin_asn,
                timestamp: now,
                classification_type: ClassificationType::Outage,
                old_classification: ClassificationType::None,
                incident_id: state.active_incident_id.clone(),
                incident_start_time: now,
                leak_detail: None,
                anomaly_details: Some(AnomalyDetails {
                    num_collectors: s.unique_hosts.len(),
                    num_peers: s.withdrawn_peers.len(),
                    num_withdrawals: s.total_with,
                    ..Default::default()
                }),
                source: "timer".to_string(),
                lat: state.lat,
                lon: state.lon,
                city: state.city.clone(),
                country: state.country.clone(),
            };

            if let Some(ref db) = self.state_db
                && let Ok(data) = serde_json::to_string(&state)
            {
                db.upsert_prefix_state(
                    prefix,
                    &data,
                    state.last_update_ts,
                    state.classified_type as i32,
                    resolved_asn,
                );
            }

            let mut states = shard.lock();
            states.put(prefix.to_string(), state);
            return Some(event);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_classifier() -> Classifier {
        Classifier::new(100, None, None)
    }

    fn mock_ctx(
        now: i64,
        host: &str,
        peer: &str,
        is_withdrawal: bool,
        origin_asn: u32,
    ) -> MessageContext {
        MessageContext {
            now,
            host: host.to_string(),
            peer: peer.to_string(),
            is_withdrawal,
            path_str: if is_withdrawal {
                String::new()
            } else {
                format!("1 2 {}", origin_asn)
            },
            comm_str: String::new(),
            origin_asn: if is_withdrawal { 0 } else { origin_asn },
            path_len: if is_withdrawal { 0 } else { 3 },
            source: "test".to_string(),
        }
    }

    fn setup_classifier_with_db() -> (Classifier, tempfile::TempDir) {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test_sled");
        let sled_db = sled::open(db_path).unwrap();
        let tree = sled_db.open_tree("seen").unwrap();
        (
            Classifier::new(100, Some(DiskTrie::new(tree)), None),
            temp_dir,
        )
    }

    #[test]
    fn test_hijack_threshold() {
        let (classifier, _tmp) = setup_classifier_with_db();
        let prefix_str = "1.1.1.0/24";
        let prefix = prefix_str.to_string();
        let net = IpNet::from_str(prefix_str).unwrap();

        // 1. Establish historical ASN in seen_db
        classifier
            .seen_db
            .as_ref()
            .unwrap()
            .insert(net, &100u32.to_be_bytes())
            .unwrap();

        // 2. New origin seen by 1 host (should NOT be Hijack yet)
        let ctx2 = mock_ctx(1001, "host2", "2.2.2.2", false, 200);
        let (res2, _) = classifier.classify_event(prefix.clone(), &ctx2, 0.0, 0.0, None, None);
        // It might be None or Discovery depending on historical_asn lookup
        if let Some(event) = res2 {
            assert_ne!(event.classification_type, ClassificationType::Hijack);
        }

        // 3. New origin seen by 2nd host (still NOT Hijack because threshold is 5)
        let ctx3 = mock_ctx(1002, "host3", "3.3.3.3", false, 200);
        let (res3, _) = classifier.classify_event(prefix.clone(), &ctx3, 0.0, 0.0, None, None);
        if let Some(event) = res3 {
            assert_ne!(event.classification_type, ClassificationType::Hijack);
        }

        // 4. New origin seen by 3rd host (still NOT Hijack)
        let ctx4 = mock_ctx(1003, "host4", "4.4.4.4", false, 200);
        let (res4, _) = classifier.classify_event(prefix.clone(), &ctx4, 0.0, 0.0, None, None);
        if let Some(event) = res4 {
            assert_ne!(event.classification_type, ClassificationType::Hijack);
        }

        // 5. New origin seen by 4th host (still NOT Hijack)
        let ctx5 = mock_ctx(1004, "host5", "5.5.5.5", false, 200);
        let (res5, _) = classifier.classify_event(prefix.clone(), &ctx5, 0.0, 0.0, None, None);
        if let Some(event) = res5 {
            assert_ne!(event.classification_type, ClassificationType::Hijack);
        }

        // 6. New origin seen by 5th host (SHOULD be Hijack)
        let ctx6 = mock_ctx(1005, "host6", "6.6.6.6", false, 200);
        let (res6, _) = classifier.classify_event(prefix.clone(), &ctx6, 0.0, 0.0, None, None);
        assert!(res6.is_some());
        assert_eq!(
            res6.unwrap().classification_type,
            ClassificationType::Hijack
        );
    }

    #[test]
    fn test_flap_detection_on_withdrawal() {
        let classifier = setup_classifier();
        let prefix = "2.2.2.0/24".to_string();

        // Use 2 hosts to meet the host threshold
        // Flap 1: Announce
        classifier.classify_event(
            prefix.clone(),
            &mock_ctx(1000, "h1", "p1", false, 100),
            0.0,
            0.0,
            None,
            None,
        );
        classifier.classify_event(
            prefix.clone(),
            &mock_ctx(1000, "h2", "p2", false, 100),
            0.0,
            0.0,
            None,
            None,
        );

        // Flap 2: Withdraw
        classifier.classify_event(
            prefix.clone(),
            &mock_ctx(1001, "h1", "p1", true, 100),
            0.0,
            0.0,
            None,
            None,
        );
        classifier.classify_event(
            prefix.clone(),
            &mock_ctx(1001, "h2", "p2", true, 100),
            0.0,
            0.0,
            None,
            None,
        );

        // Flap 3: Announce
        classifier.classify_event(
            prefix.clone(),
            &mock_ctx(1002, "h1", "p1", false, 100),
            0.0,
            0.0,
            None,
            None,
        );
        classifier.classify_event(
            prefix.clone(),
            &mock_ctx(1002, "h2", "p2", false, 100),
            0.0,
            0.0,
            None,
            None,
        );

        // Flap 4: Withdraw (SHOULD trigger Flap classification even though it's a withdrawal and currently inactive)
        let (res, _) = classifier.classify_event(
            prefix.clone(),
            &mock_ctx(1003, "h1", "p1", true, 100),
            0.0,
            0.0,
            None,
            None,
        );

        assert!(res.is_some());
        assert_eq!(res.unwrap().classification_type, ClassificationType::Flap);
    }
}
