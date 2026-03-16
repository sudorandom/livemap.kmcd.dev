import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Replace RollingWindows struct to avoid duplicate code
old_struct = """#[derive(Default)]
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

content = content.replace(old_struct, "")
# Put it back at the right place (outside of `main` but inside the file context, like near `CumulativeStats`)
content = content.replace("#[derive(Clone, Hash, Eq, PartialEq)]", old_struct + "\n#[derive(Clone, Hash, Eq, PartialEq)]")

# And inside the event ingestion loop, I messed up the rust syntax probably. Let's just cargo check first.
with open("src/main.rs", "w") as f:
    f.write(content)
