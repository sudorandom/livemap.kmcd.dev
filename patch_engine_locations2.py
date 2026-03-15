import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Make sure we also add country if City is empty but Country is not in updateCriticalEventFromTransition
content = content.replace("""
	if trans.City != "" {
		loc := trans.City
		if trans.Country != "" {
			loc = trans.City + ", " + trans.Country
		}
		if ce.Locations == "" {
			ce.Locations = loc
		} else if !strings.Contains(ce.Locations, loc) {
			ce.Locations += " | " + loc
		}
	}
""", """
	loc := ""
	if trans.City != "" && trans.Country != "" {
		loc = trans.City + ", " + trans.Country
	} else if trans.City != "" {
		loc = trans.City
	} else if trans.Country != "" {
		loc = trans.Country
	}

	if loc != "" {
		if ce.Locations == "" {
			ce.Locations = loc
		} else if !strings.Contains(ce.Locations, loc) {
			ce.Locations += " | " + loc
		}
	}
""")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
