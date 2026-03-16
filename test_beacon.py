import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Look at how BEACON_PREFIXES are defined and matched
match_beacon = "if beacon_set.contains(&pending.prefix)"
if match_beacon in content:
    print("Found beacon check!")
else:
    print("Beacon check missing!")

# Wait, `pending.prefix` is a parsed prefix. `BEACON_PREFIXES` are string slices. Let's see if there's any whitespace.
# Is the issue that BEACON_PREFIXES match strings like "84.205.65.0/24" while pending.prefix could be "84.205.65.0/24" (which matches) or maybe we need to use IpNet inclusion.
# Let's change it to check if it's within IpNet, or simply verify that `research_set` and `beacon_set` checks are happening before `batched`?
# They happen inside the `for (pending, _) in batched` loop.
# It uses `pending.prefix` and `pending.asn`.
# Let's look at `CompositionEntry` generation.
