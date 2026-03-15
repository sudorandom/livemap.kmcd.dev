import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Replace "IPv4" and "IPv6 PFXs" with "IPv4 Addrs" and "IPv6 Prefixes"
# Change format from "[%s - %s]" to "[%s] %s"
content = content.replace('impactParts = append(impactParts, fmt.Sprintf("%s IPv4", impactStr))', 'impactParts = append(impactParts, fmt.Sprintf("%s IPv4 Addrs", impactStr))')
content = content.replace('impactParts = append(impactParts, fmt.Sprintf("%d IPv6 PFXs", v6Count))', 'impactParts = append(impactParts, fmt.Sprintf("%d IPv6 Prefixes", v6Count))')
content = content.replace('ce.CachedTypeLabel = fmt.Sprintf("[%s - %s]", strings.ToUpper(ce.Anom), strings.Join(impactParts, ", "))', 'ce.CachedTypeLabel = fmt.Sprintf("[%s] %s", strings.ToUpper(ce.Anom), strings.Join(impactParts, ", "))')

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
