use crate::classifier::ClassificationType;
use std::collections::HashMap;

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

#[derive(Default)]
pub struct RollingWindows {
    pub by_location: HashMap<(i32, i32, ClassificationType), Vec<WindowEntry>>, // lat_q, lon_q, class -> entries
    pub by_asn: HashMap<(u32, ClassificationType), Vec<WindowEntry>>, // asn, class -> entries
    pub by_country: HashMap<(String, ClassificationType), Vec<WindowEntry>>, // country, class -> entries
    pub by_organization: HashMap<(String, ClassificationType), Vec<WindowEntry>>, // org, class -> entries
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
    }
}

#[derive(Clone, Hash, Eq, PartialEq)]
pub struct AggregationKey {
    pub lat_q: i32,
    pub lon_q: i32,
    pub classification: ClassificationType,
}
