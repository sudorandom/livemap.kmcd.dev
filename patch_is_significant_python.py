import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# We need to change:
# if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
#     return true
# }
# to:
# if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
#     return false
# }

# Wait, if we return false, then anything NOT those 4 will be ignored.
# The original code:
# if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
#     return true
# }
# Means if it's NOT those 4, return true. Wait, that means things like Flaps are always significant!
# The new requirement: "Only show route leak if the number of ipv4 IPs and ipv6 prefixes are above the same thresholds as outage. Same for hijacks."
# So RouteLeak, MinorRouteLeak, and Hijack should NOT return true immediately. They should pass the check.
# The original code DOES pass the check for them!
# Wait! Let's read the original code:
# if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
#     return true
# }
# if ce.ImpactedIPs >= 5000 {
#     return true
# }
# v6Count := 0
# for p := range ce.ImpactedPrefixes {
#     if strings.Contains(p, ":") {
#         v6Count++
#         if v6Count >= 20 {
#             return true
#         }
#     }
# }
# return false

# If ce.Anom == bgp.NameHardOutage, the first if is false. It goes to IP check.
# If ce.Anom == bgp.NameRouteLeak, the first if is false. It goes to IP check.
# Wait, it ALREADY DOES EXACTLY THIS.
# "Let's add thresholds for route leaks before showing events on the major event panel. Only show route leak if the number of ipv4 IPs and ipv6 prefixes are above the same thresholds as outage. Same for hijacks."
# The original code ALREADY does this!
# What about other events? If it's a FLAP, ce.Anom != ... is true, so it returns true!
# So flaps are ALWAYS significant.
# Wait, "Major events should be reserved for... MAJOR events."
# Maybe the prompt means we should ONLY show these 4 types if they meet the threshold, AND WE SHOULD NOT SHOW ANY OTHER TYPES AT ALL!
# Or maybe the first if condition should be:
# if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
#     return false
# }
# Yes! "Major events should be reserved for... MAJOR events. On that same line of thinking, we should actually create some higher-order events where bad events are aggregated by different methods:"
# Let's change `return true` to `return false` inside the first if.

old_str = """func (e *Engine) isEventSignificant(ce *CriticalEvent) bool {
	if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
		return true
	}"""

new_str = """func (e *Engine) isEventSignificant(ce *CriticalEvent) bool {
	// Only consider these major anomalies for the major event stream
	if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
		return false
	}"""

if old_str in content:
    content = content.replace(old_str, new_str)
    with open("pkg/bgpengine/engine.go", "w") as f:
        f.write(content)
    print("Patched successfully")
else:
    print("Could not find old string")
