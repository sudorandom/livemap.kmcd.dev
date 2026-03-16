import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Replace the alert generation loop

alert_gen = """                        // Check by Location
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
                        }"""

new_alert_gen = """                        // Check by Location
                        for (&(lat_q, lon_q, class), v) in &rolling_windows.by_location {
                            let mut unique_prefixes = std::collections::HashSet::new();
                            let mut ipv4_count = 0u64;
                            let mut ipv6_prefixes = 0u32;
                            let mut city_counts = std::collections::HashMap::new();
                            let mut country_counts = std::collections::HashMap::new();

                            let mut count_recent = 0;
                            for (ts, prefix, city, country, _, _) in v {
                                if unique_prefixes.insert(prefix.clone()) {
                                    if let Ok(net) = ipnet::IpNet::from_str(prefix) {
                                        match net {
                                            ipnet::IpNet::V4(v4) => ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32),
                                            ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                                        }
                                    }
                                }
                                if *ts >= now_tick - 60 {
                                    count_recent += 1;
                                }
                                if let Some(c) = city {
                                    *city_counts.entry(c.clone()).or_insert(0) += 1;
                                }
                                if let Some(c) = country {
                                    *country_counts.entry(c.clone()).or_insert(0) += 1;
                                }
                            }
                            let count = v.len() as u32;
                            let count_old = v.len() as i32 - count_recent;
                            let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                            let delta = count_recent - avg_old;
                            let percentage_increase = if avg_old > 0 { (delta as f32 / avg_old as f32) * 100.0 } else { 0.0 };
                            let top_city = city_counts.into_iter().max_by_key(|&(_, c)| c).map(|(c, _)| c).unwrap_or_default();
                            let top_country = country_counts.into_iter().max_by_key(|&(_, c)| c).map(|(c, _)| c).unwrap_or_default();

                            if ipv4_count >= 5000 || ipv6_prefixes >= 20 {
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
                                });
                            }
                        }

                        // Check by ASN
                        for (&(asn, class), v) in &rolling_windows.by_asn {
                            let mut unique_prefixes = std::collections::HashSet::new();
                            let mut ipv4_count = 0u64;
                            let mut ipv6_prefixes = 0u32;
                            let mut as_name = String::new();

                            let mut count_recent = 0;
                            for (ts, prefix, _, _, _, name) in v {
                                if unique_prefixes.insert(prefix.clone()) {
                                    if let Ok(net) = ipnet::IpNet::from_str(prefix) {
                                        match net {
                                            ipnet::IpNet::V4(v4) => ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32),
                                            ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                                        }
                                    }
                                }
                                if *ts >= now_tick - 60 {
                                    count_recent += 1;
                                }
                                if !name.is_empty() {
                                    as_name = name.clone();
                                }
                            }
                            let count = v.len() as u32;
                            let count_old = v.len() as i32 - count_recent;
                            let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                            let delta = count_recent - avg_old;
                            let percentage_increase = if avg_old > 0 { (delta as f32 / avg_old as f32) * 100.0 } else { 0.0 };

                            if ipv4_count >= 5000 || ipv6_prefixes >= 20 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByAsn.into(),
                                    location: None,
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
                                });
                            }
                        }

                        // Check by Country
                        for ((country, class), v) in &rolling_windows.by_country {
                            let mut unique_prefixes = std::collections::HashSet::new();
                            let mut ipv4_count = 0u64;
                            let mut ipv6_prefixes = 0u32;

                            let mut count_recent = 0;
                            for (ts, prefix, _, _, _, _) in v {
                                if unique_prefixes.insert(prefix.clone()) {
                                    if let Ok(net) = ipnet::IpNet::from_str(prefix) {
                                        match net {
                                            ipnet::IpNet::V4(v4) => ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32),
                                            ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                                        }
                                    }
                                }
                                if *ts >= now_tick - 60 {
                                    count_recent += 1;
                                }
                            }
                            let count = v.len() as u32;
                            let count_old = v.len() as i32 - count_recent;
                            let avg_old = (count_old as f32 / 4.0).ceil() as i32;
                            let delta = count_recent - avg_old;
                            let percentage_increase = if avg_old > 0 { (delta as f32 / avg_old as f32) * 100.0 } else { 0.0 };

                            if ipv4_count >= 5000 || ipv6_prefixes >= 20 {
                                alerts.push(Alert {
                                    alert_type: AlertType::ByCountry.into(),
                                    location: None,
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
                                });
                            }
                        }"""

content = content.replace(alert_gen, new_alert_gen)

with open("src/main.rs", "w") as f:
    f.write(content)
