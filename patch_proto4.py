import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Make sure we add initialization of alert_subscribers

content = content.replace("subscribers: RwLock::new(Vec::new()),\n        transition_subscribers", "subscribers: RwLock::new(Vec::new()),\n        alert_subscribers: RwLock::new(Vec::new()),\n        transition_subscribers")

# Now add RollingWindows logic
# We need to define RollingWindow structures
rolling_window_code = """
#[derive(Default)]
struct RollingWindows {
    by_location: HashMap<(i32, i32, ClassificationType), Vec<i64>>, // lat_q, lon_q, class -> timestamps
    by_asn: HashMap<(u32, ClassificationType), Vec<i64>>, // asn, class -> timestamps
    by_country: HashMap<(String, ClassificationType), Vec<i64>>, // country, class -> timestamps
}

impl RollingWindows {
    fn add_event(&mut self, lat: f32, lon: f32, asn: u32, country: String, class: ClassificationType, now: i64) {
        let lat_q = (lat * 10.0) as i32;
        let lon_q = (lon * 10.0) as i32;
        self.by_location.entry((lat_q, lon_q, class)).or_default().push(now);
        self.by_asn.entry((asn, class)).or_default().push(now);
        if !country.is_empty() {
            self.by_country.entry((country, class)).or_default().push(now);
        }
    }

    fn cleanup(&mut self, now: i64, window: i64) {
        let cutoff = now - window;
        self.by_location.retain(|_, v| {
            v.retain(|&ts| ts >= cutoff);
            !v.is_empty()
        });
        self.by_asn.retain(|_, v| {
            v.retain(|&ts| ts >= cutoff);
            !v.is_empty()
        });
        self.by_country.retain(|_, v| {
            v.retain(|&ts| ts >= cutoff);
            !v.is_empty()
        });
    }
}
"""

content = content.replace("#[derive(Clone, Hash, Eq, PartialEq)]\nstruct AggregationKey", rolling_window_code + "\n#[derive(Clone, Hash, Eq, PartialEq)]\nstruct AggregationKey")


# Now add the RollingWindow instance and ticker in the main loop
# We'll put it inside the existing 500ms aggregate_buffer loop, but evaluate every 60 seconds.

# Replace the loop to include rolling windows
# The aggregate_buffer loop starts with:
# let mut aggregate_buffer: HashMap<AggregationKey, u32> = HashMap::new();

old_loop_start = """let mut interval = tokio::time::interval(Duration::from_millis(500));
        let mut aggregate_buffer: HashMap<AggregationKey, u32> = HashMap::new();
        loop {"""

new_loop_start = """let mut interval = tokio::time::interval(Duration::from_millis(500));
        let mut aggregate_buffer: HashMap<AggregationKey, u32> = HashMap::new();
        let mut rolling_windows = RollingWindows::default();
        let mut last_alert_check = Utc::now().timestamp();
        loop {"""

content = content.replace(old_loop_start, new_loop_start)


# Update the event ingest
old_event_ingest = """let key = AggregationKey {
                            lat_q: (pending.lat * 10.0) as i32,
                            lon_q: (pending.lon * 10.0) as i32,
                            classification: pending.classification_type
                        };
                        *aggregate_buffer.entry(key).or_insert(0) += 1;"""

new_event_ingest = """let key = AggregationKey {
                            lat_q: (pending.lat * 10.0) as i32,
                            lon_q: (pending.lon * 10.0) as i32,
                            classification: pending.classification_type
                        };
                        *aggregate_buffer.entry(key).or_insert(0) += 1;

                        if matches!(pending.classification_type, ClassificationType::RouteLeak | ClassificationType::MinorRouteLeak | ClassificationType::Hijack | ClassificationType::Outage | ClassificationType::Flap) {
                            rolling_windows.add_event(pending.lat, pending.lon, pending.asn, pending.country.clone().unwrap_or_default(), pending.classification_type, now);
                        }"""

content = content.replace(old_event_ingest, new_event_ingest)

# Now add the periodic check in the _ = interval.tick() => block
old_tick_block = """_ = interval.tick() => {
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
                }"""

new_tick_block = """_ = interval.tick() => {
                    let now_tick = Utc::now().timestamp();
                    if now_tick - last_alert_check >= 60 {
                        rolling_windows.cleanup(now_tick, 300); // 5 minutes window
                        let mut alerts = Vec::new();

                        // Check by Location
                        for (&(lat_q, lon_q, class), v) in &rolling_windows.by_location {
                            let count = v.len() as u32;
                            if count >= 200 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByLocation.into(),
                                    location: format!("lat:{},lon:{}", lat_q as f32 / 10.0, lon_q as f32 / 10.0),
                                    asn: 0,
                                    country: String::new(),
                                    classification: map_classification(class).into(),
                                    count,
                                    delta: 0,
                                    timestamp: now_tick,
                                });
                            }
                        }

                        // Check by ASN
                        for (&(asn, class), v) in &rolling_windows.by_asn {
                            let count = v.len() as u32;
                            if count >= 500 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByAsn.into(),
                                    location: String::new(),
                                    asn,
                                    country: String::new(),
                                    classification: map_classification(class).into(),
                                    count,
                                    delta: 0,
                                    timestamp: now_tick,
                                });
                            }
                        }

                        // Check by Country
                        for ((country, class), v) in &rolling_windows.by_country {
                            let count = v.len() as u32;
                            if count >= 1000 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByCountry.into(),
                                    location: String::new(),
                                    asn: 0,
                                    country: country.clone(),
                                    classification: map_classification(*class).into(),
                                    count,
                                    delta: 0,
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
                    }

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
                }"""

content = content.replace(old_tick_block, new_tick_block)

with open("src/main.rs", "w") as f:
    f.write(content)

print("Added rolling windows")
