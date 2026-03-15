import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Add ValleyFreeViolation
content = content.replace("""		case 6:
			ce.LeakType = bgp.DDoSTrafficRedirection
		default:
			ce.LeakType = bgp.LeakUnknown""", """		case 6:
			ce.LeakType = bgp.DDoSTrafficRedirection
		case 7:
			ce.LeakType = bgp.LeakValleyFree
		default:
			ce.LeakType = bgp.LeakUnknown""")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)

with open("pkg/bgp/types.go", "r") as f:
    content2 = f.read()

if "LeakValleyFree" not in content2:
    content2 = content2.replace("""	DDoSTrafficRedirection
)""", """	DDoSTrafficRedirection
	LeakValleyFree
)""")

    content2 = content2.replace("""	default:
		return "Unknown"
	}""", """	case LeakValleyFree:
		return "Valley-Free Violation"
	default:
		return "Unknown"
	}""")

with open("pkg/bgp/types.go", "w") as f:
    f.write(content2)
