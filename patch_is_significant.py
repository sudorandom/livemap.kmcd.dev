import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

new_content = re.sub(
    r"func \(e \*Engine\) isEventSignificant\(ce \*CriticalEvent\) bool \{\n\s*if ce\.Anom != bgp\.NameHardOutage && ce\.Anom != bgp\.NameRouteLeak && ce\.Anom != bgp\.NameMinorRouteLeak && ce\.Anom != bgp\.NameHijack \{\n\s*return true\n\s*\}\n\s*if ce\.ImpactedIPs >= 5000 \{\n\s*return true\n\s*\}\n\s*v6Count := 0\n\s*for p := range ce\.ImpactedPrefixes \{\n\s*if strings\.Contains\(p, \":\"\) \{\n\s*v6Count\+\+\n\s*if v6Count >= 20 \{\n\s*return true\n\s*\}\n\s*\}\n\s*\}\n\s*return false\n\}",
    """func (e *Engine) isEventSignificant(ce *CriticalEvent) bool {
	if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
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
	}
	return false
}""",
    content
)

if new_content != content:
    with open("pkg/bgpengine/engine.go", "w") as f:
        f.write(new_content)
    print("Patched pkg/bgpengine/engine.go successfully")
else:
    print("Failed to patch pkg/bgpengine/engine.go")
