import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Let's cleanly replace it.

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

# Add logic for 0% percentage increase
# We already did this in Go, but maybe we should also filter it in rust?
# `let percentage_increase = if avg_old > 0 { (delta as f32 / avg_old as f32) * 100.0 } else { 0.0 };`
# Then we should check `if (ipv4_count >= 5000 || ipv6_prefixes >= 20) && percentage_increase > 0.0 {`
# Let's just modify the `if` checks.
content = content.replace("if ipv4_count >= 5000 || ipv6_prefixes >= 20 {", "if (ipv4_count >= 5000 || ipv6_prefixes >= 20) && percentage_increase > 0.0 {")

with open("src/main.rs", "w") as f:
    f.write(content)
