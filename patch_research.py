import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Fix beacon set and research stats

beacon_set_init = "let beacon_set: HashSet<String> = BEACON_PREFIXES.iter().map(|s| s.to_string()).collect();"
new_beacon_set_init = """let beacon_nets: Vec<ipnet::IpNet> = BEACON_PREFIXES.iter().filter_map(|s| std::str::FromStr::from_str(s).ok()).collect();"""

content = content.replace(beacon_set_init, new_beacon_set_init)

beacon_check = """                        if beacon_set.contains(&pending.prefix) { s_ingest.beacon_stats.add_event(now); }
                        else if research_set.contains(&pending.asn) { s_ingest.research_stats.add_event(now); }"""

new_beacon_check = """                        let mut is_beacon = false;
                        if let Ok(net) = std::str::FromStr::from_str(&pending.prefix) {
                            let net: ipnet::IpNet = net;
                            for bnet in &beacon_nets {
                                if bnet.contains(&net.network()) || net.contains(&bnet.network()) {
                                    is_beacon = true;
                                    break;
                                }
                            }
                        }
                        if is_beacon {
                            s_ingest.beacon_stats.add_event(now);
                        } else if research_set.contains(&pending.asn) {
                            s_ingest.research_stats.add_event(now);
                        }"""

content = content.replace(beacon_check, new_beacon_check)

with open("src/main.rs", "w") as f:
    f.write(content)
