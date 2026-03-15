import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = content.replace("""	if ce.Anom != bgp.NameHardOutage {
		return true
	}
	if ce.ImpactedIPs >= 5000 {
		return true
	}
	v6Count := 0
	for p := range ce.ImpactedPrefixes {
		if strings.Contains(p, ":") {
			v6Count++
			if v6Count >= 10 {
				return true
			}
		}
	}""", """	if ce.Anom != bgp.NameHardOutage {
		return true
	}
	if ce.ImpactedIPs >= 5000 {
		return true
	}
	v6Count := 0
	for p := range ce.ImpactedPrefixes {
		if strings.Contains(p, ":") {
			v6Count++
			if v6Count >= 20 {
				return true
			}
		}
	}""")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
