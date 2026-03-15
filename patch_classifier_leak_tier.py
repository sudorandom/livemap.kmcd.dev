import re

with open("src/classifier.rs", "r") as f:
    content = f.read()

# Add MinorRouteLeak to ClassificationType
content = content.replace("RouteLeak = 3,", "RouteLeak = 3,\n    MinorRouteLeak = 10,")

content = content.replace("3 => ClassificationType::RouteLeak,", "3 => ClassificationType::RouteLeak,\n            10 => ClassificationType::MinorRouteLeak,")

# Update find_critical_anomaly logic for route leaks
new_leak_logic = """        if s.unique_hosts.len() >= 2
            && let Some(ld) = self.detect_route_leak(prefix, ctx)
        {
            let classification = if s.unique_hosts.len() >= 5 {
                ClassificationType::RouteLeak
            } else {
                ClassificationType::MinorRouteLeak
            };
            return (
                Some(PendingEvent {
                    prefix: prefix.to_string(),
                    asn: resolved_asn,
                    as_name,
                    peer_ip: ctx.peer.clone(),
                    historical_asn: historical_origin_asn,
                    timestamp: ctx.now,
                    classification_type: classification,
                    old_classification: ClassificationType::None,
                    incident_id: None,
                    incident_start_time: 0,
                    leak_detail: Some(ld),
                    anomaly_details: None,
                    source: ctx.source.clone(),
                    lat,
                    lon,
                    city: city.clone(),
                    country: country.clone(),
                }),
                false,
            );
        }"""

content = re.sub(r'if s\.unique_hosts\.len\(\) >= 3\n\s+&& let Some\(ld\) = self\.detect_route_leak\(prefix, ctx\)\n\s+{\n.*?false,\n\s+\);\n\s+}', new_leak_logic, content, flags=re.DOTALL)

# Also update the bad vs specific broad matchings to include MinorRouteLeak
content = content.replace("ClassificationType::RouteLeak\n", "ClassificationType::RouteLeak\n                    | ClassificationType::MinorRouteLeak\n")


with open("src/classifier.rs", "w") as f:
    f.write(content)
