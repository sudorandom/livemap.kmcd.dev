import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# 1. Update the struct to include Country
content = content.replace("Locations  string\n", "Locations  string\n\tCountry    string\n")

# 2. Update updateCriticalEventFromTransition to store country if empty
content = content.replace("""
	if trans.City != "" {
		if ce.Locations == "" {
			ce.Locations = trans.City
		} else if !strings.Contains(ce.Locations, trans.City) {
			ce.Locations += " | " + trans.City
		}
	}
""", """
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
""")

# 3. Update createCriticalEventFromTransition
content = content.replace("""		Locations:         trans.City,""", """		Locations:         func() string { if trans.Country != "" && trans.City != "" { return trans.City + ", " + trans.Country } else if trans.City != "" { return trans.City } return trans.Country }(),""")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
