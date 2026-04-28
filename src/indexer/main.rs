use anyhow::Result;
use chrono::Utc;
use clap::Parser;
use std::path::{Path, PathBuf};
use tokio::fs;

pub mod livemap {
    pub mod v1 {
        tonic::include_proto!("livemap.v1");
    }
}

pub mod summary {
    pub mod v1 {
        tonic::include_proto!("summary.v1");
    }
}

use prost::Message;
use summary::v1::{
    DaySummary, HistAlert, HistAlertLocation, HistClassificationCount, HistFlappiestNetwork,
    HistLeakDetail, HistTransitionSummary,
};
use livemap::v1::live_map_service_client::LiveMapServiceClient;
use livemap::v1::{
    GetSummaryRequest, GetRecentAlertsRequest,
};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Output directory for indexer data
    out_dir: PathBuf,

    #[arg(short, long, default_value = "http://127.0.0.1:50051")]
    addr: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();
    let out_path = args.out_dir;
    fs::create_dir_all(&out_path).await?;

    // Perform a single flush and exit
    if let Err(e) = flush_buffer(&out_path, &args.addr).await {
        log::error!("Flush error: {}", e);
        return Err(e);
    }

    Ok(())
}

async fn flush_buffer(out_path: &Path, addr: &str) -> Result<()> {
    // Update Summary (summary.pb)
    let summary_path = out_path.join("summary.pb");
    let mut day_summary = if summary_path.exists() {
        let data = fs::read(&summary_path).await?;
        match DaySummary::decode(&*data) {
            Ok(ds) => ds,
            Err(e) => {
                log::warn!("Failed to decode existing summary.pb: {}. Starting fresh.", e);
                DaySummary {
                    date: Utc::now().timestamp(),
                    unique_asns: 0,
                    unique_prefixes: 0,
                    ipv4_prefix_count: 0,
                    ipv6_prefix_count: 0,
                    ipv4_count: 0,
                    rpki_valid_ipv4: 0,
                    rpki_invalid_ipv4: 0,
                    rpki_not_found_ipv4: 0,
                    rpki_valid_ipv6: 0,
                    rpki_invalid_ipv6: 0,
                    rpki_not_found_ipv6: 0,
                    flappiest_networks: vec![],
                    top_alerts: vec![],
                    classification_counts: vec![],
                }
            }
        }
    } else {
        DaySummary {
            date: Utc::now().timestamp(),
            unique_asns: 0,
            unique_prefixes: 0,
            ipv4_prefix_count: 0,
            ipv6_prefix_count: 0,
            ipv4_count: 0,
            rpki_valid_ipv4: 0,
            rpki_invalid_ipv4: 0,
            rpki_not_found_ipv4: 0,
            rpki_valid_ipv6: 0,
            rpki_invalid_ipv6: 0,
            rpki_not_found_ipv6: 0,
            flappiest_networks: vec![],
            top_alerts: vec![],
            classification_counts: vec![],
        }
    };

    log::info!("Connecting to LiveMap at {}...", addr);
    let mut client = LiveMapServiceClient::connect(addr.to_string()).await?;

    log::info!("Fetching GetSummary to update summary...");
    if let Ok(resp) = client.get_summary(GetSummaryRequest {}).await {
        let res = resp.into_inner();
        day_summary.ipv4_prefix_count = res.ipv4_prefix_count;
        day_summary.ipv6_prefix_count = res.ipv6_prefix_count;
        day_summary.ipv4_count = res.ipv4_count;
        day_summary.rpki_valid_ipv4 = res.rpki_valid_ipv4;
        day_summary.rpki_invalid_ipv4 = res.rpki_invalid_ipv4;
        day_summary.rpki_not_found_ipv4 = res.rpki_not_found_ipv4;
        day_summary.rpki_valid_ipv6 = res.rpki_valid_ipv6;
        day_summary.rpki_invalid_ipv6 = res.rpki_invalid_ipv6;
        day_summary.rpki_not_found_ipv6 = res.rpki_not_found_ipv6;
        day_summary.unique_prefixes = res.prefix_count;
        day_summary.unique_asns = res.asn_count;

        day_summary.classification_counts = res.classification_counts.into_iter().map(|c| HistClassificationCount {
            classification: c.classification,
            count: c.count,
            messages_per_second: c.messages_per_second,
            asn_count: c.asn_count,
            prefix_count: c.prefix_count,
            ipv4_prefix_count: c.ipv4_prefix_count,
            ipv6_prefix_count: c.ipv6_prefix_count,
            ipv4_count: c.ipv4_count,
            total_count: c.total_count,
        }).collect();

        day_summary.flappiest_networks = res.flappiest_network_stats.into_iter().map(|f| HistFlappiestNetwork {
            asn: f.asn,
            network_name: f.network_name,
            event_rate: f.event_rate,
            flap_count: f.flap_count,
            prefix: f.prefix,
        }).collect();
    }

    log::info!("Fetching GetRecentAlerts...");
    if let Ok(resp) = client.get_recent_alerts(GetRecentAlertsRequest {}).await {
        let res = resp.into_inner();
        day_summary.top_alerts = res.alerts.into_iter().map(|a| HistAlert {
            alert_type: a.alert_type,
            location: a.location.map(|l| HistAlertLocation {
                city: l.city,
                country: l.country,
                lat: l.lat,
                lon: l.lon,
                radius_km: l.radius_km,
            }),
            asn: a.asn,
            country: a.country,
            classification: a.classification,
            events_count: a.events_count,
            delta: a.delta,
            timestamp: a.timestamp,
            impacted_ipv4_ips: a.impacted_ipv4_ips,
            impacted_ipv6_prefixes: a.impacted_ipv6_prefixes,
            percentage_increase: a.percentage_increase,
            as_name: a.as_name,
            organization: a.organization,
            asn_count: a.asn_count,
            anomaly_score: a.anomaly_score,
            sample_events: a.sample_events.into_iter().map(|t| HistTransitionSummary {
                asn: t.asn,
                asn_name: t.as_name,
                org: t.organization,
                prefix: t.prefix,
                old_state: t.old_state,
                new_state: t.new_state,
                ts: t.start_time,
                rpki_status: t.rpki_status,
                incident_id: t.incident_id,
                anomaly_details: t.anomaly_details,
                leak_detail: t.leak_detail.map(|ld| HistLeakDetail {
                    leak_type: ld.leak_type.to_string(),
                    leaker_asn: ld.leaker_asn,
                    leaker_name: ld.leaker_as_name,
                    victim_asn: ld.victim_asn,
                    victim_name: ld.victim_as_name,
                    leaker_rpki_status: ld.leaker_rpki_status,
                    victim_rpki_status: ld.victim_rpki_status,
                }),
            }).collect(),
        }).collect();
    }

    let mut out_data = Vec::new();
    day_summary.encode(&mut out_data)?;
    fs::write(summary_path, out_data).await?;

    Ok(())
}
