import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# I will replace the end of RecordAlert properly using the correct appending logic.

record_alert_end = """	e.criticalQueue = append(e.criticalQueue, ce)
	if len(e.criticalQueue) > maxCriticalEvents {
		e.criticalQueue = e.criticalQueue[len(e.criticalQueue)-maxCriticalEvents:]
	}
}"""

new_record_alert_end = """	e.criticalQueue = append(e.criticalQueue, ce)
	e.lastCriticalAddedAt = time.Now()
	e.streamDirty = true
}"""

content = content.replace(record_alert_end, new_record_alert_end)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
