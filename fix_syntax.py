import re

with open("src/main.rs", "r") as f:
    content = f.read()

# I messed up the curly braces in `add_event` body replacement
# Let's read main.rs and fix it.
# Actually I will just replace the whole `impl RollingWindows` block

impl_block = """impl RollingWindows {
    fn add_event(
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
        };
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
        }
    }

    fn cleanup(&mut self, now: i64, window: i64) {
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
    }
}"""

content = re.sub(r'impl RollingWindows \{.*?\}\s*(?=\#\[derive\(Clone, Hash, Eq, PartialEq\)\])', impl_block + '\n\n', content, flags=re.DOTALL)

with open("src/main.rs", "w") as f:
    f.write(content)
