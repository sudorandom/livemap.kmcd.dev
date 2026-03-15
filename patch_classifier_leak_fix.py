import re

with open("src/classifier.rs", "r") as f:
    content = f.read()

content = content.replace("""        if s.unique_hosts.len() >= 2
            && let Some(ld) = self.detect_route_leak(prefix, ctx)
        {
            let classification = if s.unique_hosts.len() >= 5 {
                ClassificationType::RouteLeak
                    | ClassificationType::MinorRouteLeak
            } else {
                ClassificationType::MinorRouteLeak
            };""", """        if s.unique_hosts.len() >= 2
            && let Some(ld) = self.detect_route_leak(prefix, ctx)
        {
            let classification = if s.unique_hosts.len() >= 5 {
                ClassificationType::RouteLeak
            } else {
                ClassificationType::MinorRouteLeak
            };""")

with open("src/classifier.rs", "w") as f:
    f.write(content)
