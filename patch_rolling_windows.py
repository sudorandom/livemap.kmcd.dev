import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Update RollingWindows to store IPNet and Location info instead of just timestamp
# `Vec<i64>` -> `Vec<(i64, String, Option<String>, Option<String>, u32)>` (timestamp, prefix, city, country, asn)
# Or wait, let's just create a struct for clarity.
# Since we need a quick patch, replacing the HashMap definition:

new_hashmap_def = """    by_location: HashMap<(i32, i32, ClassificationType), Vec<(i64, String, Option<String>, Option<String>, u32, String)>>, // lat_q, lon_q, class -> (ts, prefix, city, country, asn, as_name)
    by_asn: HashMap<(u32, ClassificationType), Vec<(i64, String, Option<String>, Option<String>, u32, String)>>,
    by_country: HashMap<(String, ClassificationType), Vec<(i64, String, Option<String>, Option<String>, u32, String)>>,"""

content = re.sub(r'    by_location: HashMap<\(i32, i32, ClassificationType\), Vec<i64>>.*?\n    by_asn: HashMap<\(u32, ClassificationType\), Vec<i64>>.*?\n    by_country: HashMap<\(String, ClassificationType\), Vec<i64>>.*?', new_hashmap_def, content, flags=re.MULTILINE)

add_event_def = """    fn add_event(
        &mut self,
        lat: f32,
        lon: f32,
        asn: u32,
        country: String,
        class: ClassificationType,
        now: i64,
    ) {"""

new_add_event_def = """    fn add_event(
        &mut self,
        lat: f32,
        lon: f32,
        asn: u32,
        as_name: String,
        country_opt: Option<String>,
        city_opt: Option<String>,
        class: ClassificationType,
        now: i64,
        prefix: String,
    ) {"""

content = content.replace(add_event_def, new_add_event_def)

add_event_body = """        let lat_q = (lat * 10.0) as i32;
        let lon_q = (lon * 10.0) as i32;
        self.by_location
            .entry((lat_q, lon_q, class))
            .or_default()
            .push(now);
        self.by_asn.entry((asn, class)).or_default().push(now);
        if !country.is_empty() {
            self.by_country
                .entry((country, class))
                .or_default()
                .push(now);
        }"""

new_add_event_body = """        let lat_q = (lat * 10.0) as i32;
        let lon_q = (lon * 10.0) as i32;
        let entry = (now, prefix.clone(), city_opt.clone(), country_opt.clone(), asn, as_name.clone());
        self.by_location
            .entry((lat_q, lon_q, class))
            .or_default()
            .push(entry.clone());
        self.by_asn.entry((asn, class)).or_default().push(entry.clone());
        if let Some(country) = country_opt {
            if !country.is_empty() {
                self.by_country
                    .entry((country, class))
                    .or_default()
                    .push(entry);
            }
        }"""

content = content.replace(add_event_body, new_add_event_body)

cleanup_body = """    fn cleanup(&mut self, now: i64, window: i64) {
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
    }"""

new_cleanup_body = """    fn cleanup(&mut self, now: i64, window: i64) {
        let cutoff = now - window;
        self.by_location.retain(|_, v| {
            v.retain(|(ts, _, _, _, _, _)| *ts >= cutoff);
            !v.is_empty()
        });
        self.by_asn.retain(|_, v| {
            v.retain(|(ts, _, _, _, _, _)| *ts >= cutoff);
            !v.is_empty()
        });
        self.by_country.retain(|_, v| {
            v.retain(|(ts, _, _, _, _, _)| *ts >= cutoff);
            !v.is_empty()
        });
    }"""

content = content.replace(cleanup_body, new_cleanup_body)

# Update the call to add_event
call_add_event = "rolling_windows.add_event(pending.lat, pending.lon, pending.asn, pending.country.clone().unwrap_or_default(), pending.classification_type, now);"
new_call_add_event = "rolling_windows.add_event(pending.lat, pending.lon, pending.asn, pending.as_name.clone(), pending.country.clone(), pending.city.clone(), pending.classification_type, now, pending.prefix.clone());"
content = content.replace(call_add_event, new_call_add_event)


with open("src/main.rs", "w") as f:
    f.write(content)
