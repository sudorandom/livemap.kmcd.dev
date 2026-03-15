import re

with open("pkg/bgp/types.go", "r") as f:
    content = f.read()

content = content.replace("""	case DDoSTrafficRedirection:
		return "Traffic Redirection"
	default:
		return StrUnknown
	}""", """	case DDoSTrafficRedirection:
		return "Traffic Redirection"
	case LeakValleyFree:
		return "Valley-Free Violation"
	default:
		return StrUnknown
	}""")

with open("pkg/bgp/types.go", "w") as f:
    f.write(content)
