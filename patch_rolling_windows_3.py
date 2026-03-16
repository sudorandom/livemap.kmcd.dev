import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Fix syntax error in RollingWindows struct
content = content.replace(">>,,", ">>,")

# Let's create a struct `WindowEntry` instead of a tuple to avoid type inference issues
struct_def = """#[derive(Clone)]
struct WindowEntry {
    ts: i64,
    prefix: String,
    city: Option<String>,
    country: Option<String>,
    asn: u32,
    as_name: String,
}

#[derive(Default)]
struct RollingWindows {
    by_location: HashMap<(i32, i32, ClassificationType), Vec<WindowEntry>>, // lat_q, lon_q, class -> entries
    by_asn: HashMap<(u32, ClassificationType), Vec<WindowEntry>>,           // asn, class -> entries
    by_country: HashMap<(String, ClassificationType), Vec<WindowEntry>>,    // country, class -> entries
}"""

content = re.sub(r'#\[derive\(Default\)\]\nstruct RollingWindows \{.*?\}', struct_def, content, flags=re.MULTILINE | re.DOTALL)

# Update `add_event` to use `WindowEntry`
new_add_event_body = """        let lat_q = (lat * 10.0) as i32;
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
        }"""

content = re.sub(r'        let lat_q = \(lat \* 10\.0\) as i32;\n        let lon_q = \(lon \* 10\.0\) as i32;\n        let entry = \(now, prefix\.clone\(\), city_opt\.clone\(\), country_opt\.clone\(\), asn, as_name\.clone\(\)\);\n.*?        }', new_add_event_body, content, flags=re.DOTALL)

# Update `cleanup` to use `WindowEntry`
new_cleanup_body = """    fn cleanup(&mut self, now: i64, window: i64) {
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
    }"""

content = re.sub(r'    fn cleanup\(&mut self, now: i64, window: i64\) \{.*?    \}', new_cleanup_body, content, flags=re.DOTALL)

# Update alert generation to use `WindowEntry`
# Wait, I just need to replace `(ts, prefix, city, country, _, _)` with `e` and use `e.prefix`
content = content.replace("for (ts, prefix, city, country, _, _) in v {", "for e in v {")
content = content.replace("unique_prefixes.insert(prefix.clone())", "unique_prefixes.insert(e.prefix.clone())")
content = content.replace("ipnet::IpNet::from_str(prefix)", "ipnet::IpNet::from_str(&e.prefix)")
content = content.replace("if *ts >=", "if e.ts >=")
content = content.replace("if let Some(c) = city {", "if let Some(ref c) = e.city {")
content = content.replace("if let Some(c) = country {", "if let Some(ref c) = e.country {")

content = content.replace("for (ts, prefix, _, _, _, name) in v {", "for e in v {")
content = content.replace("if !name.is_empty() {", "if !e.as_name.is_empty() {")
content = content.replace("as_name = name.clone();", "as_name = e.as_name.clone();")

content = content.replace("for (ts, prefix, _, _, _, _) in v {", "for e in v {")

with open("src/main.rs", "w") as f:
    f.write(content)
