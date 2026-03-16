import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Add RecordAlert function
if "func (e *Engine) RecordAlert" not in content:
    func_code = """
func (e *Engine) RecordAlert(alert *livemap.Alert) {
	e.streamMu.Lock()
	defer e.streamMu.Unlock()

	ct := bgp.ClassificationType(alert.Classification)
	anomName := ct.String()

	uiCol := e.getClassificationUIColor(anomName)
	realCol, _, _ := e.getClassificationVisuals(ct)

	// Create Critical Event based on alert type
	alertType := ""
	locStr := ""
	switch alert.AlertType {
	case livemap.AlertType_ALERT_TYPE_BY_LOCATION:
		alertType = "[SPIKE: LOCATION]"
		locStr = alert.Location
	case livemap.AlertType_ALERT_TYPE_BY_ASN:
		alertType = "[SPIKE: ASN]"
		locStr = fmt.Sprintf("AS%d", alert.Asn)
	case livemap.AlertType_ALERT_TYPE_BY_COUNTRY:
		alertType = "[SPIKE: COUNTRY]"
		locStr = alert.Country
	}

	ce := &CriticalEvent{
		Timestamp:       time.Unix(alert.Timestamp, 0),
		Anom:            anomName,
		ASN:             alert.Asn,
		ASNStr:          locStr,
		Locations:       alert.Location,
		Color:           realCol,
		UIColor:         uiCol,
		CachedTypeLabel: alertType + " " + anomName,
		CachedFirstLine: fmt.Sprintf("Count: %d (Delta: %d)", alert.Count, alert.Delta),
		ImpactedIPs:     uint64(alert.Count),
	}

	if e.subMonoFace != nil {
		ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
	}

	e.criticalQueue = append(e.criticalQueue, ce)
	e.lastCriticalAddedAt = time.Now()
	e.streamDirty = true
}
"""
    content += func_code
    with open("pkg/bgpengine/engine.go", "w") as f:
        f.write(content)
    print("Added RecordAlert to engine.go")
else:
    print("RecordAlert already exists")
