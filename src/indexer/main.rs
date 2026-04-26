use anyhow::Result;
use bgpkit_commons::BgpkitCommons;
use chrono::Utc;
use clap::Parser;
use prost::Message;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex;
use tokio::time::{self, Duration};

pub mod livemap {
    pub mod v1 {
        tonic::include_proto!("livemap.v1");
    }
}

pub mod historical {
    pub mod v1 {
        include!(concat!(env!("OUT_DIR"), "/historical.v1.rs"));
    }
}

use historical::v1::{
    AsnMetadata, DailyAsnArchive, DailyPrefixArchive, DaySummary, GlobalMetadataIndex,
    GlobalPrefixShard, HistLeakDetail, HistTransitionSummary, OrgArchive, OrgMetadata,
    PrefixHistory, PrefixSnapshot, Transition as HistTransition,
};
use livemap::v1::live_map_service_client::LiveMapServiceClient;
use livemap::v1::{StreamPrefixSnapshotsRequest, StreamStateTransitionsRequest};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long, default_value = "http://127.0.0.1:50051")]
    addr: String,

    #[arg(short, long, default_value = "web/public/data")]
    out_dir: String,

    #[arg(short, long, default_value = "300")]
    flush_interval: u64,
}

struct IndexerState {
    // ASN -> Prefix -> Vec<Transitions>
    buffer: HashMap<u32, HashMap<String, Vec<HistTransition>>>,
    bgpkit: Option<BgpkitCommons>,
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();
    let out_path = PathBuf::from(&args.out_dir);
    fs::create_dir_all(&out_path).await?;

    let mut bgpkit = BgpkitCommons::new();
    let bgpkit = tokio::task::spawn_blocking(move || {
        if let Err(e) = bgpkit.load_asinfo_cached() {
            log::warn!(
                "Failed to load BGPKIT AS info from cache: {}. Will fetch on demand.",
                e
            );
        }
        bgpkit
    })
    .await?;

    // Build and save global metadata index immediately
    build_global_index(&out_path, &bgpkit).await?;

    let state = Arc::new(Mutex::new(IndexerState {
        buffer: HashMap::new(),
        bgpkit: Some(bgpkit),
    }));

    let state_clone = state.clone();
    let addr = args.addr.clone();

    // Background task to consume gRPC stream
    tokio::spawn(async move {
        loop {
            if let Err(e) = consume_stream(&addr, state_clone.clone()).await {
                log::error!("Stream consumer error: {}. Retrying in 5s...", e);
                time::sleep(Duration::from_secs(5)).await;
            }
        }
    });

    // Background task for prefix snapshots (every 10 minutes)
    let out_snap = out_path.clone();
    let addr_snap = args.addr.clone();
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(600));
        loop {
            interval.tick().await;
            if let Err(e) = update_prefix_snapshots(&addr_snap, &out_snap).await {
                log::error!("Prefix snapshot update error: {}", e);
            }
        }
    });

    // Main loop for flushing data and cleanup
    let mut flush_interval = time::interval(Duration::from_secs(args.flush_interval));
    let mut report_interval = time::interval(Duration::from_secs(5));

    loop {
        tokio::select! {
            _ = flush_interval.tick() => {
                if let Err(e) = flush_buffer(&out_path, state.clone()).await {
                    log::error!("Flush error: {}", e);
                }
                if let Err(e) = cleanup_old_days(&out_path).await {
                    log::error!("Cleanup error: {}", e);
                }
            }
            _ = report_interval.tick() => {
                let s = state.lock().await;
                let asn_count = s.buffer.len();
                let event_count: usize = s.buffer.values().map(|pfxs| pfxs.values().map(|events| events.len()).sum::<usize>()).sum();
                log::info!("[BUFFER] {} ASNs, {} events pending", asn_count, event_count);
            }
        }
    }
}

async fn build_global_index(out_path: &Path, bgpkit: &BgpkitCommons) -> Result<()> {
    log::info!("Building global metadata index...");
    let mut index = GlobalMetadataIndex {
        asns: vec![],
        orgs: vec![],
    };

    let mut org_set: HashMap<String, String> = HashMap::new();

    // Iterate through all ASNs known to bgpkit
    for asn in 1..800000 {
        if let Ok(Some(info)) = bgpkit.asinfo_get(asn) {
            let org_name = info
                .as2org
                .as_ref()
                .map(|o| o.org_name.clone())
                .unwrap_or_default();
            index.asns.push(AsnMetadata {
                asn,
                name: info.name.clone(),
                org: org_name.clone(),
                rpki_status: 0,
            });

            if !org_name.is_empty() {
                org_set.insert(slugify(&org_name), org_name);
            }
        }
    }

    for (slug, name) in org_set {
        index.orgs.push(OrgMetadata { name, slug });
    }

    log::info!(
        "Index complete: {} ASNs, {} Organizations",
        index.asns.len(),
        index.orgs.len()
    );

    let mut out_data = Vec::new();
    index.encode(&mut out_data)?;
    fs::write(out_path.join("metadata.pb"), out_data).await?;

    Ok(())
}

async fn update_prefix_snapshots(addr: &str, out_path: &Path) -> Result<()> {
    log::info!("Updating global prefix snapshots...");
    let mut client = LiveMapServiceClient::connect(addr.to_string()).await?;
    let mut stream = client
        .stream_prefix_snapshots(StreamPrefixSnapshotsRequest {})
        .await?
        .into_inner();

    let mut all_snapshots = Vec::new();
    while let Some(resp) = stream.message().await? {
        for s in resp.snapshots {
            all_snapshots.push(PrefixSnapshot {
                prefix: s.prefix,
                classification: s.classification,
                asn: s.asn,
                last_update_ts: s.last_update_ts,
                total_events: s.total_events,
            });
        }
    }

    log::info!(
        "Captured {} prefix snapshots. Sharding...",
        all_snapshots.len()
    );

    // Shard by first octet to keep files small
    let mut shards: HashMap<String, Vec<PrefixSnapshot>> = HashMap::new();
    for s in all_snapshots {
        let octet = s.prefix.split('.').next().unwrap_or("0").to_string();
        shards.entry(octet).or_default().push(s);
    }

    let snap_dir = out_path.join("prefixes");
    fs::create_dir_all(&snap_dir).await?;

    for (octet, snapshots) in shards {
        let shard = GlobalPrefixShard { snapshots };
        let mut out_data = Vec::new();
        shard.encode(&mut out_data)?;
        let shard_dir = snap_dir.join(&octet);
        fs::create_dir_all(&shard_dir).await?;
        let shard_file = shard_dir.join("metadata.pb");
        fs::write(shard_file, out_data).await?;
    }

    Ok(())
}

async fn consume_stream(addr: &str, state: Arc<Mutex<IndexerState>>) -> Result<()> {
    log::info!("Connecting to LiveMap at {}...", addr);
    let mut client = LiveMapServiceClient::connect(addr.to_string()).await?;
    let request = StreamStateTransitionsRequest {
        target_states: vec![], // All states
    };

    let mut stream = client.stream_state_transitions(request).await?.into_inner();
    log::info!("Subscribed to state transitions");

    while let Some(resp) = stream.message().await? {
        if let Some(t) = resp.transition {
            let mut s = state.lock().await;
            let asn_entry = s.buffer.entry(t.asn).or_default();
            let pfx_entry = asn_entry.entry(t.prefix).or_default();

            pfx_entry.push(HistTransition {
                old_state: t.old_state,
                new_state: t.new_state,
                ts: t.start_time,
                incident_id: t.incident_id,
                anomaly_details: t.anomaly_details,
                rpki_status: t.rpki_status,
                leak_detail: t.leak_detail.map(|ld| HistLeakDetail {
                    leak_type: ld.leak_type.to_string(),
                    leaker_asn: ld.leaker_asn,
                    leaker_name: ld.leaker_as_name,
                    victim_asn: ld.victim_asn,
                    victim_name: ld.victim_as_name,
                    leaker_rpki_status: ld.leaker_rpki_status,
                    victim_rpki_status: ld.victim_rpki_status,
                }),
            });
        }
    }

    Ok(())
}

async fn flush_buffer(out_path: &Path, state: Arc<Mutex<IndexerState>>) -> Result<()> {
    let mut s = state.lock().await;
    if s.buffer.is_empty() {
        return Ok(());
    }

    let now = Utc::now();
    let day_str = now.format("%Y-%m-%d").to_string();
    let day_path = out_path.join(&day_str);
    fs::create_dir_all(&day_path.join("asns")).await?;
    fs::create_dir_all(&day_path.join("orgs")).await?;

    let mut buffer = std::mem::take(&mut s.buffer);
    let mut org_asns: HashMap<String, HashSet<u32>> = HashMap::new();
    let mut new_summaries: Vec<HistTransitionSummary> = Vec::new();
    let mut total_new_events = 0;

    log::info!("Flushing transitions for {} ASNs...", buffer.len());

    for (asn, prefixes) in buffer.drain() {
        let shard = format!("{:02}", asn % 100);
        let shard_path = day_path.join("asns").join(&shard);
        fs::create_dir_all(&shard_path).await?;

        let file_path = shard_path.join(format!("{}.pb", asn));

        let mut archive = if file_path.exists() {
            let data = fs::read(&file_path).await?;
            DailyAsnArchive::decode(data.as_slice())?
        } else {
            let (name, org) = if let Some(ref bgpkit) = s.bgpkit {
                let info = bgpkit.asinfo_get(asn).ok().flatten();
                let n = info.as_ref().map(|i| i.name.clone()).unwrap_or_default();
                let o = info
                    .and_then(|i| i.as2org.map(|org| org.org_name))
                    .unwrap_or_default();
                (n, o)
            } else {
                (String::new(), String::new())
            };

            DailyAsnArchive {
                asn,
                name,
                org,
                prefixes: vec![],
            }
        };

        if !archive.org.is_empty() {
            org_asns.entry(archive.org.clone()).or_default().insert(asn);
        }

        for (prefix, events) in prefixes {
            total_new_events += events.len();
            if let Some(latest) = events.last() {
                new_summaries.push(HistTransitionSummary {
                    asn,
                    asn_name: archive.name.clone(),
                    org: archive.org.clone(),
                    prefix: prefix.clone(),
                    old_state: latest.old_state,
                    new_state: latest.new_state,
                    ts: latest.ts,
                    rpki_status: latest.rpki_status,
                });
            }

            // Write out DailyPrefixArchive
            let pfx_slug = slugify(&prefix);
            let pfx_octet = prefix.split('.').next().unwrap_or("0").to_string();
            let pfx_shard_path = day_path.join("prefixes").join(&pfx_octet);
            fs::create_dir_all(&pfx_shard_path).await?;

            let pfx_file_path = pfx_shard_path.join(format!("{}.pb", pfx_slug));
            let mut pfx_archive = if pfx_file_path.exists() {
                let data = fs::read(&pfx_file_path).await?;
                DailyPrefixArchive::decode(data.as_slice())?
            } else {
                DailyPrefixArchive {
                    prefix: prefix.clone(),
                    asn,
                    events: vec![],
                }
            };
            pfx_archive.events.extend(events.clone());
            let mut pfx_out_data = Vec::new();
            pfx_archive.encode(&mut pfx_out_data)?;
            fs::write(pfx_file_path, pfx_out_data).await?;

            if let Some(pfx_hist) = archive.prefixes.iter_mut().find(|p| p.prefix == prefix) {
                pfx_hist.events.extend(events);
            } else {
                archive.prefixes.push(PrefixHistory {
                    prefix: prefix.clone(),
                    events,
                });
            }
        }

        let mut out_data = Vec::new();
        archive.encode(&mut out_data)?;
        fs::write(file_path, out_data).await?;
    }

    // Update Day Summary (summary.pb)
    let summary_path = day_path.join("summary.pb");
    let mut day_summary = if summary_path.exists() {
        let data = fs::read(&summary_path).await?;
        DaySummary::decode(data.as_slice())?
    } else {
        DaySummary {
            date: now
                .date_naive()
                .and_hms_opt(0, 0, 0)
                .unwrap()
                .and_utc()
                .timestamp(),
            total_transitions: 0,
            unique_asns: 0,
            unique_prefixes: 0,
            latest_events: vec![],
            unique_orgs: 0,
        }
    };

    day_summary.total_transitions += total_new_events as u32;

    // Sort and truncate recent events
    let mut all_events = new_summaries;
    all_events.sort_by_key(|b| std::cmp::Reverse(b.ts));
    day_summary.latest_events.splice(0..0, all_events);
    day_summary.latest_events.truncate(100);

    let mut out_data = Vec::new();
    day_summary.encode(&mut out_data)?;
    fs::write(summary_path.clone(), out_data).await?;

    // Update Org files and track global unique counts
    for (org_name, asns) in org_asns {
        let slug = slugify(&org_name);
        let org_file = day_path.join("orgs").join(format!("{}.pb", slug));

        let mut archive = if org_file.exists() {
            let data = fs::read(&org_file).await?;
            OrgArchive::decode(data.as_slice())?
        } else {
            OrgArchive {
                org: org_name.clone(),
                asns: vec![],
                event_count: 0,
            }
        };

        archive.event_count += 1;

        for asn in asns {
            if !archive.asns.contains(&asn) {
                archive.asns.push(asn);
            }
        }
        archive.asns.sort();

        let mut out_data = Vec::new();
        archive.encode(&mut out_data)?;
        fs::write(org_file, out_data).await?;
    }

    // Update index.json
    update_day_index(out_path, &day_str).await?;

    // Update global day summary stats (count actual files on disk for accuracy)
    if let Ok(mut entries) = fs::read_dir(day_path.join("orgs")).await {
        let mut org_count = 0;
        while let Ok(Some(_)) = entries.next_entry().await {
            org_count += 1;
        }
        day_summary.unique_orgs = org_count;

        let mut out_data = Vec::new();
        day_summary.encode(&mut out_data)?;
        fs::write(summary_path, out_data).await?;
    }

    Ok(())
}

fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

async fn update_day_index(out_path: &Path, new_day: &str) -> Result<()> {
    let index_path = out_path.join("index.json");
    let mut days: HashSet<String> = if index_path.exists() {
        let data = fs::read_to_string(&index_path).await?;
        serde_json::from_str(&data)?
    } else {
        HashSet::new()
    };

    if days.insert(new_day.to_string()) {
        let mut days_vec: Vec<String> = days.into_iter().collect();
        days_vec.sort_by(|a, b| b.cmp(a));
        let data = serde_json::to_string_pretty(&days_vec)?;
        fs::write(index_path, data).await?;
    }

    Ok(())
}

async fn cleanup_old_days(out_path: &Path) -> Result<()> {
    let mut entries = fs::read_dir(out_path).await?;
    let now = Utc::now();

    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "index.json" || name == "metadata.pb" {
            continue;
        }

        if let Ok(date) = chrono::NaiveDate::parse_from_str(&name, "%Y-%m-%d") {
            let days_old = now.date_naive().signed_duration_since(date).num_days();
            if days_old > 7 {
                log::info!("Cleaning up old day: {}", name);
                fs::remove_dir_all(entry.path()).await?;
            }
        }
    }
    Ok(())
}
