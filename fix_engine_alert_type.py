import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Replace "[OUTAGE]" with "[OUTAGE] [SUB TYPE]" if there is a sub type? Wait, the problem is they want:
# "[ROUTE LEAK] [SUB TYPE]" instead of "[ROUTE LEAK - SUB TYPE]".
# `ct.String()` might return "ROUTE LEAK - SUB TYPE".
# Let's split it if it has " - ".

split_logic = """	ct := bgp.ClassificationType(alert.Classification)
	anomName := strings.ToUpper(ct.String())
	cachedTypeLabel := fmt.Sprintf("[%s]", anomName)
	if strings.Contains(anomName, " - ") {
		parts := strings.Split(anomName, " - ")
		cachedTypeLabel = fmt.Sprintf("[%s] [%s]", parts[0], parts[1])
	}"""

content = content.replace("""	ct := bgp.ClassificationType(alert.Classification)
	anomName := strings.ToUpper(ct.String())

	uiCol := e.getClassificationUIColor(ct.String())
	realCol, _, _ := e.getClassificationVisuals(ct)""", """	ct := bgp.ClassificationType(alert.Classification)
	anomName := strings.ToUpper(ct.String())
	cachedTypeLabel := fmt.Sprintf("[%s]", anomName)
	if strings.Contains(anomName, " - ") {
		parts := strings.Split(anomName, " - ")
		cachedTypeLabel = fmt.Sprintf("[%s] [%s]", parts[0], parts[1])
	}

	uiCol := e.getClassificationUIColor(ct.String())
	realCol, _, _ := e.getClassificationVisuals(ct)""")

content = content.replace("""	// [ROUTE LEAK] [SUB TYPE]
	cachedTypeLabel := fmt.Sprintf("[%s]", anomName)""", """	// [ROUTE LEAK] [SUB TYPE] already calculated""")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
