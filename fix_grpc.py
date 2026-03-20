import re

with open("pkg/bgpengine/grpc_worker.go", "r") as f:
    content = f.read()

content = content.replace("""	if e.topStatsFlappiestASN != resp.GetFlappiestAsnStr() || e.topStatsFlappiestOrg != resp.GetFlappiestNetwork() || e.topStatsLargestOrg != resp.GetLargestOrgName() || e.topStatsRPKIValidIPv4 != resp.GetRpkiValidIpv4() {
		e.topStatsDirty = true
	}

	e.topStatsFlappiestASN = resp.GetFlappiestAsnStr()
	e.topStatsFlappiestOrg = resp.GetFlappiestNetwork()""", """	if e.topStatsFlappiestPrefix != resp.GetFlappiestPrefix() || e.topStatsFlappiestASN != resp.GetFlappiestAsnStr() || e.topStatsFlappiestOrg != resp.GetFlappiestNetwork() || e.topStatsLargestOrg != resp.GetLargestOrgName() || e.topStatsRPKIValidIPv4 != resp.GetRpkiValidIpv4() {
		e.topStatsDirty = true
	}

	e.topStatsFlappiestPrefix = resp.GetFlappiestPrefix()
	e.topStatsFlappiestASN = resp.GetFlappiestAsnStr()
	e.topStatsFlappiestOrg = resp.GetFlappiestNetwork()""")

with open("pkg/bgpengine/grpc_worker.go", "w") as f:
    f.write(content)
