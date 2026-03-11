use bgpkit_parser::BgpElem;
use ipnet::IpNet;
use lru::LruCache;
use serde::{Deserialize, Serialize};
use sled::Db;
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr};
use std::num::NonZeroUsize;
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct DiskTrie {
    tree: sled::Tree,
}

impl DiskTrie {
    pub fn new(tree: sled::Tree) -> Self {
        Self { tree }
    }

    fn make_key(ip: Ipv4Addr, prefix_len: u8) -> [u8; 5] {
        let octets = ip.octets();
        [octets[0], octets[1], octets[2], octets[3], prefix_len]
    }

    pub fn insert(&self, prefix: IpNet, value: &[u8]) -> sled::Result<()> {
        if let IpAddr::V4(v4) = prefix.addr() {
            let key = Self::make_key(v4, prefix.prefix_len());
            self.tree.insert(key, value)?;
        }
        Ok(())
    }

    pub fn lookup_lpm(&self, ip: Ipv4Addr) -> sled::Result<Option<(u8, Vec<u8>)>> {
        for len in (0..=32).rev() {
            let mask = !((1u64 << (32 - len)) - 1) as u32;
            let masked_ip = Ipv4Addr::from(u32::from(ip) & mask);
            let key = Self::make_key(masked_ip, len as u8);
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
    Outage = 4,
    DDoSMitigation = 5,
    Flap = 6,
    TrafficEngineering = 7,
    PathHunting = 8,
    Discovery = 9,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakDetail {
    pub leak_type: LeakType,
    pub leaker_asn: u32,
    pub victim_asn: u32,
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
    pub classified_type: ClassificationType,
    pub classified_time_ts: i64,
    pub leak_type: LeakType,
    pub leaker_asn: u32,
    pub victim_asn: u32,
    pub uncategorized_counted: bool,
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
            classified_type: ClassificationType::None,
            classified_time_ts: 0,
            leak_type: LeakType::None,
            leaker_asn: 0,
            victim_asn: 0,
            uncategorized_counted: false,
        }
    }
}

pub struct MessageContext<'a> {
    pub elem: &'a BgpElem,
    pub now: i64,
    pub host: String,
    pub peer: String,
    pub is_withdrawal: bool,
    pub path_str: String,
    pub comm_str: String,
    pub origin_asn: u32,
    pub path_len: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEvent {
    pub prefix: String,
    pub asn: u32,
    pub historical_asn: u32,
    pub classification_type: ClassificationType,
    pub leak_detail: Option<LeakDetail>,
    pub anomaly_details: Option<AnomalyDetails>,
}

pub struct Classifier {
    pub prefix_states: Mutex<LruCache<String, PrefixState>>,
    pub seen_db: Option<DiskTrie>,
    pub state_db: Option<Db>,
    pub bgpkit: Option<bgpkit_commons::BgpkitCommons>,
}

impl Classifier {
    pub fn new(capacity: usize, seen_db: Option<DiskTrie>, state_db: Option<Db>) -> Self {
        let mut bgpkit = bgpkit_commons::BgpkitCommons::new();
        let bgpkit_opt = if bgpkit.load_asinfo(true, false, true, false).is_ok() {
            Some(bgpkit)
        } else {
            None
        };

        Self {
            prefix_states: Mutex::new(LruCache::new(NonZeroUsize::new(capacity).unwrap())),
            seen_db,
            state_db,
            bgpkit: bgpkit_opt,
        }
    }

    pub fn classify_event(&self, prefix: String, ctx: &MessageContext) -> Option<PendingEvent> {
        if prefix.contains(':') {
            return None;
        }

        let mut states = self.prefix_states.lock().unwrap();

        let mut state = states.get(&prefix).cloned();
        if state.is_none() {
            if let Some(ref db) = self.state_db {
                if let Ok(Some(data)) = db.get(&prefix) {
                    state = serde_json::from_slice(&data).ok();
                }
            }
        }

        let mut state = state.unwrap_or_default();
        state.last_update_ts = ctx.now;

        let minute_ts = (ctx.now / 60) * 60;
        let cutoff = ctx.now - 600;
        state.buckets.retain(|&ts, _| ts >= cutoff);

        {
            let bucket = state.buckets.entry(minute_ts).or_default();
            bucket.total_messages += 1;
        }

        let historical_origin_asn = self.get_historical_asn(&prefix);

        if ctx.is_withdrawal {
            {
                let bucket = state.buckets.entry(minute_ts).or_default();
                bucket.withdrawals += 1;
            }
            let session_key = format!("{}:{}", ctx.host, ctx.peer);
            let last = state
                .peer_last_attrs
                .entry(session_key)
                .or_insert_with(|| LastAttrs {
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
                });
            last.withdrawn = true;
            last.last_update_ts = ctx.now;
        } else {
            self.update_announcement_stats(&mut state, minute_ts, ctx);
        }

        let mut result = None;

        // Sticky classification for some time
        if state.classified_type != ClassificationType::None {
            let expiry = match state.classified_type {
                ClassificationType::Outage => 300,
                ClassificationType::Flap => 60,
                _ => 600,
            };
            if ctx.now - state.classified_time_ts > expiry {
                state.classified_type = ClassificationType::None;
            } else if state.classified_type == ClassificationType::Outage && !ctx.is_withdrawal {
                let bucket_ann = state
                    .buckets
                    .get(&minute_ts)
                    .map(|b| b.announcements)
                    .unwrap_or(0);
                if bucket_ann > 2 {
                    // Outage recovery
                    state.classified_type = ClassificationType::None;
                } else {
                    result = Some(PendingEvent {
                        prefix: prefix.clone(),
                        asn: ctx.origin_asn,
                        historical_asn: historical_origin_asn,
                        classification_type: state.classified_type,
                        leak_detail: if state.leak_type != LeakType::None {
                            Some(LeakDetail {
                                leak_type: state.leak_type,
                                leaker_asn: state.leaker_asn,
                                victim_asn: state.victim_asn,
                            })
                        } else {
                            None
                        },
                        anomaly_details: None,
                    });
                }
            } else {
                result = Some(PendingEvent {
                    prefix: prefix.clone(),
                    asn: ctx.origin_asn,
                    historical_asn: historical_origin_asn,
                    classification_type: state.classified_type,
                    leak_detail: if state.leak_type != LeakType::None {
                        Some(LeakDetail {
                            leak_type: state.leak_type,
                            leaker_asn: state.leaker_asn,
                            victim_asn: state.victim_asn,
                        })
                    } else {
                        None
                    },
                    anomaly_details: None,
                });
            }
        }

        if result.is_none() {
            result = self.evaluate_prefix_state(&prefix, &mut state, historical_origin_asn, ctx);
        }

        // If still no classification and it's an announcement, check if it's new
        if result.is_none() && !ctx.is_withdrawal && historical_origin_asn == 0 {
            result = Some(PendingEvent {
                prefix: prefix.clone(),
                asn: ctx.origin_asn,
                historical_asn: 0,
                classification_type: ClassificationType::Discovery,
                leak_detail: None,
                anomaly_details: None,
            });

            if let Some(ref seen_db) = self.seen_db {
                if let Ok(net) = IpNet::from_str(&prefix) {
                    let _ = seen_db.insert(net, &ctx.origin_asn.to_be_bytes());
                }
            }
        }

        // Persist state
        if let Some(ref db) = self.state_db {
            if let Ok(data) = serde_json::to_vec(&state) {
                let _ = db.insert(&prefix, data);
            }
        }
        states.put(prefix, state);

        result
    }

    fn get_historical_asn(&self, prefix: &str) -> u32 {
        if let Some(ref seen_db) = self.seen_db {
            if let Ok(net) = IpNet::from_str(prefix) {
                if let IpAddr::V4(v4) = net.addr() {
                    if let Ok(Some((_, val))) = seen_db.lookup_lpm(v4) {
                        if val.len() == 4 {
                            return u32::from_be_bytes([val[0], val[1], val[2], val[3]]);
                        }
                    }
                }
            }
        }
        0
    }

    fn update_announcement_stats(
        &self,
        state: &mut PrefixState,
        minute_ts: i64,
        ctx: &MessageContext,
    ) {
        let bucket = state.buckets.entry(minute_ts).or_default();
        bucket.announcements += 1;

        let session_key = format!("{}:{}", ctx.host, ctx.peer);
        if let Some(last) = state.peer_last_attrs.get_mut(&session_key) {
            if ctx.path_str != last.path {
                bucket.path_changes += 1;
            }
            if ctx.comm_str != last.communities {
                bucket.community_changes += 1;
            }
            if (ctx.path_len as i32) != last.last_path_len && last.last_path_len != 0 {
                if (ctx.path_len as i32) > last.last_path_len {
                    bucket.path_length_increases += 1;
                } else {
                    bucket.path_length_decreases += 1;
                }
            }
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

    fn evaluate_prefix_state(
        &self,
        prefix: &str,
        state: &mut PrefixState,
        historical_origin_asn: u32,
        ctx: &MessageContext,
    ) -> Option<PendingEvent> {
        let stats = self.aggregate_recent_buckets(state, ctx.now, ctx.origin_asn);
        let elapsed = (ctx.now - stats.earliest_ts).max(1);

        if let Some(event) =
            self.find_critical_anomaly(prefix, &stats, elapsed as f64, ctx, historical_origin_asn)
        {
            state.classified_type = event.classification_type;
            state.classified_time_ts = ctx.now;
            if let Some(ref ld) = event.leak_detail {
                state.leak_type = ld.leak_type;
                state.leaker_asn = ld.leaker_asn;
                state.victim_asn = ld.victim_asn;
            }
            return Some(event);
        }

        None
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
        }

        for (peer, attr) in &state.peer_last_attrs {
            if attr.withdrawn {
                s.withdrawn_peers.insert(peer.clone());
            } else if attr.origin_asn == current_origin_asn {
                s.unique_peers.insert(peer.clone());
                s.unique_hosts.insert(attr.host.clone());
            }
        }

        s
    }

    fn find_critical_anomaly(
        &self,
        prefix: &str,
        s: &AggregatedStats,
        elapsed: f64,
        ctx: &MessageContext,
        historical_origin_asn: u32,
    ) -> Option<PendingEvent> {
        // 1. Bogon
        if self.is_bogon(prefix, ctx) {
            return Some(PendingEvent {
                prefix: prefix.to_string(),
                asn: ctx.origin_asn,
                historical_asn: historical_origin_asn,
                classification_type: ClassificationType::Bogon,
                leak_detail: None,
                anomaly_details: None,
            });
        }

        // 2. Hijack
        if historical_origin_asn != 0
            && ctx.origin_asn != 0
            && ctx.origin_asn != historical_origin_asn
        {
            // Check if it's a known relation (conceptual, here just basic check)
            if !self.is_likely_sibling(ctx.origin_asn, historical_origin_asn) {
                return Some(PendingEvent {
                    prefix: prefix.to_string(),
                    asn: ctx.origin_asn,
                    historical_asn: historical_origin_asn,
                    classification_type: ClassificationType::Hijack,
                    leak_detail: None,
                    anomaly_details: None,
                });
            }
        }

        // 3. Outage
        let total_known_peers = s.unique_peers.len() + s.withdrawn_peers.len();
        if elapsed > 30.0 && total_known_peers >= 3 && s.unique_peers.is_empty() {
            return Some(PendingEvent {
                prefix: prefix.to_string(),
                asn: ctx.origin_asn,
                historical_asn: historical_origin_asn,
                classification_type: ClassificationType::Outage,
                leak_detail: None,
                anomaly_details: Some(AnomalyDetails {
                    num_collectors: s.unique_hosts.len(),
                    num_peers: s.withdrawn_peers.len(),
                    num_withdrawals: s.total_with,
                    ..Default::default()
                }),
            });
        }

        // 4. Route Leak
        if let Some(ld) = self.detect_route_leak(ctx) {
            return Some(PendingEvent {
                prefix: prefix.to_string(),
                asn: ctx.origin_asn,
                historical_asn: historical_origin_asn,
                classification_type: ClassificationType::RouteLeak,
                leak_detail: Some(ld),
                anomaly_details: None,
            });
        }

        // 5. DDoS Mitigation
        if self.is_ddos_mitigation(ctx) {
            return Some(PendingEvent {
                prefix: prefix.to_string(),
                asn: ctx.origin_asn,
                historical_asn: historical_origin_asn,
                classification_type: ClassificationType::DDoSMitigation,
                leak_detail: None,
                anomaly_details: None,
            });
        }

        // 6. Flap
        if s.total_ann > 5 && s.total_with > 5 && (s.total_ann + s.total_with) > 15 {
            return Some(PendingEvent {
                prefix: prefix.to_string(),
                asn: ctx.origin_asn,
                historical_asn: historical_origin_asn,
                classification_type: ClassificationType::Flap,
                leak_detail: None,
                anomaly_details: None,
            });
        }

        // 7. Path Hunting
        if s.path_len_inc > 3 && s.path_changes > 5 {
            return Some(PendingEvent {
                prefix: prefix.to_string(),
                asn: ctx.origin_asn,
                historical_asn: historical_origin_asn,
                classification_type: ClassificationType::PathHunting,
                leak_detail: None,
                anomaly_details: None,
            });
        }

        // 8. Traffic Engineering
        if s.path_changes > 3 && s.path_len_inc == s.path_len_dec && s.path_len_inc > 0 {
            return Some(PendingEvent {
                prefix: prefix.to_string(),
                asn: ctx.origin_asn,
                historical_asn: historical_origin_asn,
                classification_type: ClassificationType::TrafficEngineering,
                leak_detail: None,
                anomaly_details: None,
            });
        }

        None
    }

    fn is_bogon(&self, prefix: &str, _ctx: &MessageContext) -> bool {
        if let Ok(net) = IpNet::from_str(prefix) {
            let addr = net.addr();
            if addr.is_loopback() || addr.is_multicast() || addr.is_unspecified() {
                return true;
            }
            match addr {
                IpAddr::V4(v4) => {
                    if v4.is_private() || v4.is_link_local() {
                        return true;
                    }
                    let octets = v4.octets();
                    if octets[0] == 100 && (octets[1] & 0b11000000) == 64 {
                        return true;
                    }
                    if octets[0] == 192 && octets[1] == 0 && octets[2] == 2 {
                        return true;
                    }
                    if octets[0] == 198 && octets[1] == 51 && octets[2] == 100 {
                        return true;
                    }
                    if octets[0] == 203 && octets[1] == 0 && octets[2] == 113 {
                        return true;
                    }
                }
                IpAddr::V6(v6) => {
                    if v6.is_unicast_link_local() {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn detect_route_leak(&self, ctx: &MessageContext) -> Option<LeakDetail> {
        let path = self.parse_path(&ctx.path_str);
        if path.len() < 3 {
            return None;
        }

        for i in 0..path.len() - 2 {
            let (p1, p2, p3) = (path[i], path[i + 1], path[i + 2]);
            // Valley-free violation: provider-peer-provider or similar
            if self.is_tier1(p1) && !self.is_large_network(p2) && self.is_tier1(p3) {
                return Some(LeakDetail {
                    leak_type: LeakType::Hairpin,
                    leaker_asn: p2,
                    victim_asn: p3,
                });
            }
        }
        None
    }

    fn is_ddos_mitigation(&self, ctx: &MessageContext) -> bool {
        // Look for common DDoS mitigation communities or ASNs
        // Cloudflare (13335), Akamai (20940), Imperva (19551), etc.
        let path = self.parse_path(&ctx.path_str);
        if path
            .iter()
            .any(|&asn| matches!(asn, 13335 | 20940 | 19551 | 19324 | 19281))
        {
            return true;
        }
        // Blackhole communities
        if ctx.comm_str.contains("65535:666") || ctx.comm_str.contains(":666") {
            return true;
        }
        false
    }

    fn is_likely_sibling(&self, asn1: u32, asn2: u32) -> bool {
        if let Some(ref bgpkit) = self.bgpkit {
            if let (Ok(Some(info1)), Ok(Some(info2))) =
                (bgpkit.asinfo_get(asn1), bgpkit.asinfo_get(asn2))
            {
                if let (Some(org1), Some(org2)) = (&info1.as2org, &info2.as2org) {
                    if org1.org_id == org2.org_id {
                        return true;
                    }
                }
            }
        }

        // Fallback to common examples if authoritative data is unavailable
        match (asn1, asn2) {
            (13335, 132892) => true, // Cloudflare
            (15169, 16591) => true,  // Google
            _ => false,
        }
    }

    fn parse_path(&self, path_str: &str) -> Vec<u32> {
        path_str
            .trim_matches(|c| c == '[' || c == ']')
            .split_whitespace()
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    }

    fn is_tier1(&self, asn: u32) -> bool {
        if let Some(ref bgpkit) = self.bgpkit {
            if let Ok(Some(info)) = bgpkit.asinfo_get(asn) {
                if let Some(h) = info.hegemony {
                    if h.ipv4 >= 0.015 || h.ipv6 >= 0.015 {
                        return true;
                    }
                }
            }
        }

        matches!(
            asn,
            209 | 701
                | 702
                | 1239
                | 1299
                | 2828
                | 2914
                | 3257
                | 3320
                | 3356
                | 3491
                | 3549
                | 3561
                | 5511
                | 6453
                | 6461
                | 6762
                | 6830
                | 7018
                | 12956
        )
    }

    fn is_large_network(&self, asn1: u32) -> bool {
        if self.is_tier1(asn1) {
            return true;
        }

        if let Some(ref bgpkit) = self.bgpkit {
            if let Ok(Some(info)) = bgpkit.asinfo_get(asn1) {
                if let Some(h) = info.hegemony {
                    if h.ipv4 >= 0.005 || h.ipv6 >= 0.005 {
                        return true;
                    }
                }
            }
        }

        matches!(
            asn1,
            174 | 6939 | 9002 | 1273 | 4637 | 7922 | 4134 | 4809 | 4837 | 7473 | 9808
        )
    }
}

struct AggregatedStats {
    pub earliest_ts: i64,
    pub total_ann: u32,
    pub total_with: u32,
    pub total_msgs: u32,
    pub path_changes: u32,
    pub path_len_inc: u32,
    pub path_len_dec: u32,
    pub unique_peers: HashSet<String>,
    pub unique_hosts: HashSet<String>,
    pub withdrawn_peers: HashSet<String>,
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
            unique_peers: HashSet::new(),
            unique_hosts: HashSet::new(),
            withdrawn_peers: HashSet::new(),
        }
    }
}
