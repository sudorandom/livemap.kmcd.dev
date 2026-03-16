import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Update the RecordAlert format

new_record_alert_def = """func (e *Engine) RecordAlert(alert *livemap.Alert) {
	if alert.PercentageIncrease <= 0 {
		return
	}

	e.streamMu.Lock()
	defer e.streamMu.Unlock()

	ct := bgp.ClassificationType(alert.Classification)
	anomName := strings.ToUpper(ct.String())

	uiCol := e.getClassificationUIColor(ct.String())
	realCol, _, _ := e.getClassificationVisuals(ct)

	locStr := ""
	switch alert.AlertType {
	case livemap.AlertType_ALERT_TYPE_BY_LOCATION:
		if alert.Location != nil && alert.Location.City != "" {
			locStr = fmt.Sprintf("Around %s, %s", alert.Location.City, alert.Location.Country)
		} else if alert.Location != nil {
			locStr = fmt.Sprintf("%.1f, %.1f", alert.Location.Lat, alert.Location.Lon)
		} else {
			locStr = "Unknown"
		}
	case livemap.AlertType_ALERT_TYPE_BY_ASN:
		if alert.AsName != "" {
			locStr = fmt.Sprintf("AS%d - %s", alert.Asn, alert.AsName)
		} else {
			locStr = fmt.Sprintf("AS%d", alert.Asn)
		}
	case livemap.AlertType_ALERT_TYPE_BY_COUNTRY:
		locStr = fmt.Sprintf("%s", alert.Country)
	}

	metricStr := ""
	if alert.ImpactedIpv4Ips > 0 {
		metricStr = fmt.Sprintf("%d IPv4 IPs; %.0f%% Increase", alert.ImpactedIpv4Ips, alert.PercentageIncrease)
	} else if alert.ImpactedIpv6Prefixes > 0 {
		metricStr = fmt.Sprintf("%d IPv6 Prefixes; %.0f%% Increase", alert.ImpactedIpv6Prefixes, alert.PercentageIncrease)
	} else {
		metricStr = fmt.Sprintf("%d Events; %.0f%% Increase", alert.EventsCount, alert.PercentageIncrease)
	}

	// [ROUTE LEAK] [SUB TYPE]
	cachedTypeLabel := fmt.Sprintf("[%s]", anomName)

	ce := &CriticalEvent{
		Timestamp:       time.Unix(alert.Timestamp, 0),
		Anom:            ct.String(),
		ASN:             alert.Asn,
		ASNStr:          "",
		Locations:       locStr,
		Color:           realCol,
		UIColor:         uiCol,
		CachedTypeLabel: cachedTypeLabel,
		CachedFirstLine: metricStr,
		CachedLocVal:    locStr,
		CachedLocLabel:  "  Location: ",
		ImpactedIPs:     alert.ImpactedIpv4Ips,
	}

	if alert.AlertType == livemap.AlertType_ALERT_TYPE_BY_ASN {
		ce.CachedLocLabel = "  Network: "
	}

	if e.subMonoFace != nil {
		ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
	}

	e.criticalQueue = append(e.criticalQueue, ce)
	e.lastCriticalAddedAt = time.Now()
	e.streamDirty = true
}"""

content = re.sub(r'func \(e \*Engine\) RecordAlert\(alert \*livemap\.Alert\) \{.*?\n\}', new_record_alert_def, content, flags=re.DOTALL)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
