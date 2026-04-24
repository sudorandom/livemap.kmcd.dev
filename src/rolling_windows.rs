use crate::classifier::ClassificationType;
use std::collections::HashMap;

#[derive(Clone)]
pub struct PrefixAnomalyStats {
    pub current_window_count: f64,
    pub last_window_ts: i64,
    pub ewma_mean: f64,
    pub ewma_var: f64,
}

impl Default for PrefixAnomalyStats {
    fn default() -> Self {
        Self {
            current_window_count: 0.0,
            last_window_ts: 0,
            ewma_mean: 0.0,
            ewma_var: 0.0,
        }
    }
}

impl PrefixAnomalyStats {
    pub fn update(&mut self, now: i64) {
        let current_window = now / 60; // 1-minute window
        let last_window = self.last_window_ts / 60;

        if self.last_window_ts == 0 {
            self.last_window_ts = now;
            self.current_window_count = 1.0;
        } else if current_window > last_window {
            let alpha = 0.95; // decay factor

            // Apply EWMA update
            let diff = self.current_window_count - self.ewma_mean;
            let incr = (1.0 - alpha) * diff;
            self.ewma_mean += incr;
            self.ewma_var = alpha * (self.ewma_var + diff * incr);

            // For missed windows (if more than 1 minute passed), update with 0
            if current_window - last_window > 1 {
                for _ in 0..(current_window - last_window - 1).min(60) {
                    // cap at 60 minutes
                    let d = 0.0 - self.ewma_mean;
                    let i = (1.0 - alpha) * d;
                    self.ewma_mean += i;
                    self.ewma_var = alpha * (self.ewma_var + d * i);
                }
            }

            self.current_window_count = 1.0;
            self.last_window_ts = now;
        } else {
            self.current_window_count += 1.0;
        }
    }

    pub fn z_score(&self, now: i64) -> f64 {
        let current_window = now / 60;
        let last_window = self.last_window_ts / 60;

        let count = if current_window > last_window {
            0.0 // The window rolled over, but this prefix hasn't had an event yet
        } else {
            self.current_window_count
        };

        let std_dev = self.ewma_var.sqrt();
        if std_dev < 1e-5 {
            if count > self.ewma_mean {
                return count - self.ewma_mean;
            } else {
                return 0.0;
            }
        }
        (count - self.ewma_mean) / std_dev
    }
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct WindowEntry {
    pub ts: i64,
    pub prefix: String,
    pub city: Option<String>,
    pub country: Option<String>,
    pub asn: u32,
    pub as_name: String,
    pub org_name: Option<String>,
    pub lat: f32,
    pub lon: f32,
}

#[derive(Default, Clone)]
pub struct RollingWindows {
    pub by_location: HashMap<(i32, i32, ClassificationType), Vec<WindowEntry>>, // lat_q, lon_q, class -> entries
    pub by_asn: HashMap<(u32, ClassificationType), Vec<WindowEntry>>, // asn, class -> entries
    pub by_country: HashMap<(String, ClassificationType), Vec<WindowEntry>>, // country, class -> entries
    pub by_organization: HashMap<(String, ClassificationType), Vec<WindowEntry>>, // org, class -> entries
    pub prefix_stats: HashMap<String, PrefixAnomalyStats>,
}

impl RollingWindows {
    #[allow(clippy::too_many_arguments)]
    pub fn add_event(
        &mut self,
        lat: f32,
        lon: f32,
        asn: u32,
        as_name: String,
        org_name: Option<String>,
        country_opt: Option<String>,
        city_opt: Option<String>,
        class: ClassificationType,
        now: i64,
        prefix: String,
    ) {
        let stat = self.prefix_stats.entry(prefix.clone()).or_default();
        stat.update(now);

        let lat_q = (lat * 10.0) as i32;
        let lon_q = (lon * 10.0) as i32;
        let entry = WindowEntry {
            ts: now,
            prefix: prefix.clone(),
            city: city_opt.clone(),
            country: country_opt.clone(),
            asn,
            as_name: as_name.clone(),
            org_name: org_name.clone(),
            lat,
            lon,
        };
        self.by_location
            .entry((lat_q, lon_q, class))
            .or_default()
            .push(entry.clone());
        self.by_asn
            .entry((asn, class))
            .or_default()
            .push(entry.clone());
        if let Some(country) = country_opt
            && !country.is_empty()
        {
            self.by_country
                .entry((country, class))
                .or_default()
                .push(entry.clone());
        }
        if let Some(org) = org_name
            && !org.is_empty()
        {
            self.by_organization
                .entry((org, class))
                .or_default()
                .push(entry);
        }
    }

    pub fn cleanup(&mut self, now: i64, window: i64) {
        let cutoff = now - window;
        self.by_location.retain(|_, v| {
            v.retain(|e| e.ts >= cutoff);
            !v.is_empty()
        });
        self.by_asn.retain(|_, v| {
            v.retain(|e| e.ts >= cutoff);
            !v.is_empty()
        });
        self.by_country.retain(|_, v| {
            v.retain(|e| e.ts >= cutoff);
            !v.is_empty()
        });
        self.by_organization.retain(|_, v| {
            v.retain(|e| e.ts >= cutoff);
            !v.is_empty()
        });

        // Cleanup prefix_stats - remove if not seen for 1 hour
        let stats_cutoff = now - 3600;
        self.prefix_stats
            .retain(|_, v| v.last_window_ts >= stats_cutoff);
    }
}

#[derive(Clone, Hash, Eq, PartialEq)]
pub struct AggregationKey {
    pub lat_q: i32,
    pub lon_q: i32,
    pub classification: ClassificationType,
}
