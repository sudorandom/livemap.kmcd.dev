import re

with open("src/main.rs", "r") as f:
    content = f.read()

# The Research/Organic stats panel in the UI is probably relying on `GetSummaryResponse.event_composition`.
# Let's check `event_composition` population.
match = re.search(r'let total_60s = self\.state\.global_stats\.get_rate_for_window\(now, 60\) \* 60\.0;.*?Ok\(Response::new', content, flags=re.DOTALL)
if match:
    print("Found composition generation")
    print(match.group(0))
