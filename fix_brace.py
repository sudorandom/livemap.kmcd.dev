import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Looks like line 1185 has an extra `} else if research_set.contains(&pending.asn) {`
content = content.replace("""                        } else if research_set.contains(&pending.asn) {
                            s_ingest.research_stats.add_event(now);
                        }
                        } else if research_set.contains(&pending.asn) {
                            s_ingest.research_stats.add_event(now);
                        }""", """                        } else if research_set.contains(&pending.asn) {
                            s_ingest.research_stats.add_event(now);
                        }""")

with open("src/main.rs", "w") as f:
    f.write(content)
