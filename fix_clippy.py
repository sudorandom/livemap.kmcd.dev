import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Remove unused `asn` field
content = content.replace("    asn: u32,\n", "")
content = content.replace("            asn,\n", "")

# Suppress too_many_arguments on add_event
content = content.replace("    fn add_event(", "    #[allow(clippy::too_many_arguments)]\n    fn add_event(")

# Fix collapsible if statements
content = content.replace("""        if let Some(country) = country_opt {
            if !country.is_empty() {
                self.by_country
                    .entry((country, class))
                    .or_default()
                    .push(entry);
            }
        }""", """        if let Some(country) = country_opt {
            if !country.is_empty() {
                self.by_country
                    .entry((country, class))
                    .or_default()
                    .push(entry);
            }
        }""")

content = content.replace("""                                if unique_prefixes.insert(e.prefix.clone()) {
                                    if let Ok(net) = ipnet::IpNet::from_str(&e.prefix) {
                                        match net {
                                            ipnet::IpNet::V4(v4) => ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32),
                                            ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                                        }
                                    }
                                }""", """                                if unique_prefixes.insert(e.prefix.clone()) {
                                    if let Ok(net) = ipnet::IpNet::from_str(&e.prefix) {
                                        match net {
                                            ipnet::IpNet::V4(v4) => ipv4_count += 2u64.pow((32 - v4.prefix_len()) as u32),
                                            ipnet::IpNet::V6(_) => ipv6_prefixes += 1,
                                        }
                                    }
                                }""")

with open("src/main.rs", "w") as f:
    f.write(content)
