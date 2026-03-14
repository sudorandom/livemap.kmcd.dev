import re

file_path = "pkg/bgpengine/engine.go"
with open(file_path, "r") as f:
    content = f.read()

replacement = """	if trans.IncidentId != "" {
		ce.ActiveIncidentIDs[trans.IncidentId] = struct{}{}
	}

	if trans.AsName != "" {
		ce.OrgID = trans.AsName
	}

	if trans.LeakDetail != nil {
		if trans.LeakDetail.LeakerAsn > 0 {
			ce.LeakerASN = trans.LeakDetail.LeakerAsn
		}
		if trans.LeakDetail.LeakerAsName != "" {
			ce.LeakerName = trans.LeakDetail.LeakerAsName
		}
		ce.LeakerRPKI = trans.LeakDetail.LeakerRpkiStatus

		if trans.LeakDetail.VictimAsn > 0 {
			ce.VictimASN = trans.LeakDetail.VictimAsn
		}
		if trans.LeakDetail.VictimAsName != "" {
			ce.VictimName = trans.LeakDetail.VictimAsName
		}
		ce.VictimRPKI = trans.LeakDetail.VictimRpkiStatus

		switch trans.LeakDetail.LeakType {
		case 1:
			ce.LeakType = bgp.LeakReOrigination
		case 2:
			ce.LeakType = bgp.LeakHairpin
		case 3:
			ce.LeakType = bgp.LeakLateral
		case 4:
			ce.LeakType = bgp.DDoSFlowspec
		case 5:
			ce.LeakType = bgp.DDoSRTBH
		case 6:
			ce.LeakType = bgp.DDoSTrafficRedirection
		default:
			ce.LeakType = bgp.LeakUnknown
		}
	}"""

content = content.replace('\tif trans.IncidentId != "" {\n\t\tce.ActiveIncidentIDs[trans.IncidentId] = struct{}{}\n\t}', replacement, 1)

with open(file_path, "w") as f:
    f.write(content)
