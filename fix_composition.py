import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Wait! The requirement says:
# "It should be reporting on the percentage of events that belong to known BGP research networks and events that are matching the beacon prefixes versus the rest of the traffic, aka, organic. But currently it has 100% organic traffic right now."

# The issue is that `beacon_set` and `research_set` check happens against `pending.prefix` and `pending.asn`.
# `beacon_set.contains(&pending.prefix)` ONLY matches exactly "84.205.65.0/24". If an event is a sub-prefix, it misses.
# Let's fix the beacon/research set to match IpNet and subsets.

# Wait, `EXCLUDED_ASNS` and `BEACON_PREFIXES` are constants.
# We can create a PrefixTrie or just check parsing.

# Let's see how `beacon_set` is initialized.
# `let beacon_set: HashSet<String> = BEACON_PREFIXES.iter().map(|s| s.to_string()).collect();`

# We can parse them into `IpNet` and check if `pending.prefix` is contained.
# Actually, the user says "belong to known BGP research networks and events that are matching the beacon prefixes".
# If I use `ipnet-trie` or just parse them.

trie_init = """    let mut beacon_trie = ipnet_trie::IpnetTrie::new();
    for p in BEACON_PREFIXES {
        if let Ok(net) = ipnet::IpNet::from_str(p) {
            beacon_trie.insert(net, true);
        }
    }
    let research_set: HashSet<u32> = EXCLUDED_ASNS.iter().cloned().collect();"""

content = re.sub(r'let beacon_set: HashSet<String> = BEACON_PREFIXES.*?;\n\s*let research_set: HashSet<u32> = EXCLUDED_ASNS.*?;', trie_init, content, flags=re.DOTALL)

# Now in the loop
check_beacon = """                        if let Ok(net) = ipnet::IpNet::from_str(&pending.prefix) {
                            if beacon_trie.longest_match(net).is_some() {
                                s_ingest.beacon_stats.add_event(now);
                            } else if research_set.contains(&pending.asn) {
                                s_ingest.research_stats.add_event(now);
                            }
                        } else if research_set.contains(&pending.asn) {
                            s_ingest.research_stats.add_event(now);
                        }"""

content = re.sub(r'if beacon_set\.contains\(&pending\.prefix\) \{ s_ingest\.beacon_stats\.add_event\(now\); \}\n\s*else if research_set\.contains\(&pending\.asn\) \{ s_ingest\.research_stats\.add_event\(now\); \}', check_beacon, content, flags=re.DOTALL)

with open("src/main.rs", "w") as f:
    f.write(content)
