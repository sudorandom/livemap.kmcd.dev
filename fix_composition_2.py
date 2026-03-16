import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Let's use prefix_trie crate if it is there, or just iterate `BEACON_PREFIXES`. It's only 23 elements!
# `IpNet` has `contains` method. So we can just iterate.

trie_init = """    let beacon_nets: Vec<ipnet::IpNet> = BEACON_PREFIXES.iter().filter_map(|s| ipnet::IpNet::from_str(s).ok()).collect();
    let research_set: HashSet<u32> = EXCLUDED_ASNS.iter().cloned().collect();"""

content = re.sub(r'let mut beacon_trie = ipnet_trie::IpnetTrie::new\(\);\n\s*for p in BEACON_PREFIXES \{\n\s*if let Ok\(net\) = ipnet::IpNet::from_str\(p\) \{\n\s*beacon_trie\.insert\(net, true\);\n\s*\}\n\s*\}\n\s*let research_set: HashSet<u32> = EXCLUDED_ASNS\.iter\(\)\.cloned\(\)\.collect\(\);', trie_init, content, flags=re.DOTALL)

check_beacon = """                        let mut is_beacon = false;
                        if let Ok(net) = ipnet::IpNet::from_str(&pending.prefix) {
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

content = re.sub(r'if let Ok\(net\) = ipnet::IpNet::from_str\(&pending\.prefix\) \{.*?s_ingest\.research_stats\.add_event\(now\);\n\s*\}', check_beacon, content, flags=re.DOTALL)

with open("src/main.rs", "w") as f:
    f.write(content)
