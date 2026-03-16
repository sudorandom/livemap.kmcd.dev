import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

new_record_alert_def = """func (e *Engine) RecordAlert(alert *livemap.Alert) {
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
			locStr = fmt.Sprintf("Location: Around %s, %s", alert.Location.City, alert.Location.Country)
		} else if alert.Location != nil {
			locStr = fmt.Sprintf("Location: %.1f, %.1f", alert.Location.Lat, alert.Location.Lon)
		} else {
			locStr = "Location: Unknown"
		}
	case livemap.AlertType_ALERT_TYPE_BY_ASN:
		if alert.AsName != "" {
			locStr = fmt.Sprintf("Network: AS%d - %s", alert.Asn, alert.AsName)
		} else {
			locStr = fmt.Sprintf("Network: AS%d", alert.Asn)
		}
	case livemap.AlertType_ALERT_TYPE_BY_COUNTRY:
		locStr = fmt.Sprintf("Location: %s", alert.Country)
	}

	metricStr := ""
	if alert.ImpactedIpv4Ips > 0 {
		metricStr = fmt.Sprintf("%d IPv4 IPs", alert.ImpactedIpv4Ips)
	} else if alert.ImpactedIpv6Prefixes > 0 {
		metricStr = fmt.Sprintf("%d IPv6 Prefixes", alert.ImpactedIpv6Prefixes)
	} else {
		metricStr = fmt.Sprintf("%d Events", alert.EventsCount)
	}

	// [OUTAGE] 7778 Prefixes; 401% Increase Location: Around Helsinki, FI
	cachedTypeLabel := fmt.Sprintf("[%s] %s; %.0f%% Increase %s", anomName, metricStr, alert.PercentageIncrease, locStr)

	ce := &CriticalEvent{
		Timestamp:       time.Unix(alert.Timestamp, 0),
		Anom:            ct.String(),
		ASN:             alert.Asn,
		ASNStr:          locStr,
		Locations:       locStr,
		Color:           realCol,
		UIColor:         uiCol,
		CachedTypeLabel: cachedTypeLabel,
		CachedFirstLine: "",
		ImpactedIPs:     alert.ImpactedIpv4Ips,
	}

	if e.subMonoFace != nil {
		ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
	}

	e.criticalQueue = append(e.criticalQueue, ce)
	if len(e.criticalQueue) > maxCriticalEvents {
		e.criticalQueue = e.criticalQueue[len(e.criticalQueue)-maxCriticalEvents:]
	}
}"""

content = re.sub(r'func \(e \*Engine\) RecordAlert\(alert \*livemap\.Alert\) \{.*?\n\}', new_record_alert_def, content, flags=re.DOTALL)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
