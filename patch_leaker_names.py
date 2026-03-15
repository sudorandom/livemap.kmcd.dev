import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# cacheLeakStrings
content = content.replace("""	// Leaker line
	ce.CachedLeakerLabel = "   Leaker"
	if ce.LeakerASN > 0 {
		if ce.LeakerName != "" {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d (%s)", ce.LeakerASN, ce.LeakerName)
		} else {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d", ce.LeakerASN)
		}
	} else {
		ce.CachedLeakerVal = "Unknown"
	}

	// Impacted ASN line
	ce.CachedVictimLabel = " Impacted"
	if ce.VictimASN > 0 {
		if ce.VictimName != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.VictimName)
		} else {
			ce.CachedVictimVal = fmt.Sprintf("AS%d", ce.VictimASN)
		}
	} else {
		ce.CachedVictimVal = ce.ASNStr
	}""", """	// Leaker line
	ce.CachedLeakerLabel = "   Leaker"
	if ce.LeakerASN > 0 {
		if ce.LeakerName != "" {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d (%s)", ce.LeakerASN, ce.LeakerName)
		} else {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d", ce.LeakerASN)
		}
	} else {
		ce.CachedLeakerVal = "Unknown"
	}

	// Impacted ASN line
	ce.CachedVictimLabel = " Impacted"
	if ce.VictimASN > 0 {
		if ce.VictimName != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.VictimName)
		} else {
			ce.CachedVictimVal = fmt.Sprintf("AS%d", ce.VictimASN)
		}
	} else {
		if ce.OrgID != "" {
			ce.CachedVictimVal = fmt.Sprintf("%s (%s)", ce.ASNStr, ce.OrgID)
		} else {
			ce.CachedVictimVal = ce.ASNStr
		}
	}""")

# cacheHijackDDoSStrings
content = content.replace("""	// Attacker / Source line
	if ce.Anom == bgp.NameDDoSMitigation {
		ce.CachedLeakerLabel = "   Target"
	} else {
		ce.CachedLeakerLabel = " Attacker"
	}
	if ce.LeakerASN > 0 {
		if ce.LeakerName != "" {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d (%s)", ce.LeakerASN, ce.LeakerName)
		} else {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d", ce.LeakerASN)
		}
	} else {
		ce.CachedLeakerVal = "Unknown"
	}

	// Victim line
	if ce.Anom == bgp.NameDDoSMitigation {
		ce.CachedVictimLabel = "   Source"
	} else {
		ce.CachedVictimLabel = "   Victim"
	}
	if ce.VictimASN > 0 {
		if ce.VictimName != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.VictimName)
		} else {
			ce.CachedVictimVal = fmt.Sprintf("AS%d", ce.VictimASN)
		}
	} else {
		ce.CachedVictimVal = ce.ASNStr
	}""", """	// Attacker / Source line
	if ce.Anom == bgp.NameDDoSMitigation {
		ce.CachedLeakerLabel = "   Target"
	} else {
		ce.CachedLeakerLabel = " Attacker"
	}
	if ce.LeakerASN > 0 {
		if ce.LeakerName != "" {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d (%s)", ce.LeakerASN, ce.LeakerName)
		} else {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d", ce.LeakerASN)
		}
	} else {
		ce.CachedLeakerVal = "Unknown"
	}

	// Victim line
	if ce.Anom == bgp.NameDDoSMitigation {
		ce.CachedVictimLabel = "   Source"
	} else {
		ce.CachedVictimLabel = "   Victim"
	}
	if ce.VictimASN > 0 {
		if ce.VictimName != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.VictimName)
		} else {
			ce.CachedVictimVal = fmt.Sprintf("AS%d", ce.VictimASN)
		}
	} else {
		if ce.OrgID != "" {
			ce.CachedVictimVal = fmt.Sprintf("%s (%s)", ce.ASNStr, ce.OrgID)
		} else {
			ce.CachedVictimVal = ce.ASNStr
		}
	}""")

# leak detection update in cacheLeakStrings
content = content.replace('ce.CachedTypeLabel = fmt.Sprintf("[%s]", strings.ToUpper(ce.Anom))', """	if ce.Anom == bgp.NameRouteLeak && ce.LeakType != bgp.LeakUnknown && ce.LeakType != bgp.LeakNone {
		ce.CachedTypeLabel = fmt.Sprintf("[%s - %s]", strings.ToUpper(ce.Anom), strings.ToUpper(ce.LeakType.String()))
	} else {
		ce.CachedTypeLabel = fmt.Sprintf("[%s]", strings.ToUpper(ce.Anom))
	}""")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
