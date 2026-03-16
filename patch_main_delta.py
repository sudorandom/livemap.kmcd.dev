import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Let's find the tick block using regex
pattern = r"_ = interval\.tick\(\) => \{\n\s*let now_tick = Utc::now\(\)\.timestamp\(\);\n\s*if now_tick - last_alert_check >= 60 \{[\s\S]*?last_alert_check = now_tick;\n\s*\}"

match = re.search(pattern, content)
if match:
    old_tick_block = match.group(0)

    new_tick_block = """_ = interval.tick() => {
                    let now_tick = Utc::now().timestamp();
                    if now_tick - last_alert_check >= 60 {
                        rolling_windows.cleanup(now_tick, 300); // 5 minutes window
                        let mut alerts = Vec::new();

                        // Check by Location
                        for (&(lat_q, lon_q, class), v) in &rolling_windows.by_location {
                            let count = v.len() as u32;
                            let count_recent = v.iter().filter(|&&ts| ts >= now_tick - 60).count() as i32;
                            let count_old = v.len() as i32 - count_recent;
                            let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                            let delta = count_recent - avg_old;

                            // Emit alert if delta is significant (e.g. > 50 spike in last minute compared to avg of previous 4 mins)
                            if count >= 100 && delta > 50 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByLocation.into(),
                                    location: format!("lat:{},lon:{}", lat_q as f32 / 10.0, lon_q as f32 / 10.0),
                                    asn: 0,
                                    country: String::new(),
                                    classification: map_classification(class).into(),
                                    count,
                                    delta,
                                    timestamp: now_tick,
                                });
                            }
                        }

                        // Check by ASN
                        for (&(asn, class), v) in &rolling_windows.by_asn {
                            let count = v.len() as u32;
                            let count_recent = v.iter().filter(|&&ts| ts >= now_tick - 60).count() as i32;
                            let count_old = v.len() as i32 - count_recent;
                            let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                            let delta = count_recent - avg_old;

                            if count >= 200 && delta > 100 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByAsn.into(),
                                    location: String::new(),
                                    asn,
                                    country: String::new(),
                                    classification: map_classification(class).into(),
                                    count,
                                    delta,
                                    timestamp: now_tick,
                                });
                            }
                        }

                        // Check by Country
                        for ((country, class), v) in &rolling_windows.by_country {
                            let count = v.len() as u32;
                            let count_recent = v.iter().filter(|&&ts| ts >= now_tick - 60).count() as i32;
                            let count_old = v.len() as i32 - count_recent;
                            let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                            let delta = count_recent - avg_old;

                            if count >= 500 && delta > 250 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByCountry.into(),
                                    location: String::new(),
                                    asn: 0,
                                    country: country.clone(),
                                    classification: map_classification(*class).into(),
                                    count,
                                    delta,
                                    timestamp: now_tick,
                                });
                            }
                        }

                        if !alerts.is_empty() {
                            let mut alert_subs = s_ingest.alert_subscribers.write().await;
                            for alert in alerts {
                                alert_subs.retain(|sub| sub.try_send(Ok(StreamAlertsResponse { alert: Some(alert.clone()) })).is_ok());
                            }
                        }

                        last_alert_check = now_tick;
                    }"""

    content = content.replace(old_tick_block, new_tick_block)
    with open("src/main.rs", "w") as f:
        f.write(content)
    print("Patched main.rs with delta calculation.")
else:
    print("Could not find tick block with regex.")
