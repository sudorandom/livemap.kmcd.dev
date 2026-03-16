import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Delete specific structs manually via regex
structs_to_remove = [
    r"type EventShape int\n\nconst \([\s\S]*?\)\n\n",
    r"type Pulse struct \{[\s\S]*?\}\n\n",
    r"type QueuedPulse struct \{[\s\S]*?\}\n\n",
    r"type PulseKey struct \{[\s\S]*?\}\n\n",
    r"type BufferedCity struct \{[\s\S]*?\}\n\n",
    r"type asnGroupKey struct \{[\s\S]*?\}\n\n",
    r"type CriticalEvent struct \{[\s\S]*?\}\n\n",
    r"type statsEvent struct \{[\s\S]*?\}\n\n",
    r"type bgpEvent struct \{[\s\S]*?\}\n\n",
    r"type VisualHub struct \{[\s\S]*?\}\n\n",
    r"type PrefixCount struct \{[\s\S]*?\}\n\n",
    r"type ASNImpact struct \{[\s\S]*?\}\n\n",
    r"type VisualImpact struct \{[\s\S]*?\}\n\n",
    r"type MetricSnapshot struct \{[\s\S]*?\}\n\n",
    r"type asnGroup struct \{[\s\S]*?\}\n\n",
]

for pattern in structs_to_remove:
    content = re.sub(pattern, "", content, count=1)

# Remove colors
colors_pattern = r"var \(\n\s+ColorGossip = color\.RGBA[\s\S]*?ColorOpen = color\.RGBA[\s\S]*?\n\)"
content = re.sub(colors_pattern, "", content, count=1)

# Remove consts
consts_pattern = r"const \(\n\s+MaxActivePulses[\s\S]*?VisualQueueCull[\s\S]*?\n\)"
content = re.sub(consts_pattern, "", content, count=1)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
