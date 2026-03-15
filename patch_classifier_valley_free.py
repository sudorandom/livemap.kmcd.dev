import re

with open("src/classifier.rs", "r") as f:
    content = f.read()

# Add ValleyFree to LeakType
content = content.replace("TrafficRedirection = 6,", "TrafficRedirection = 6,\n    ValleyFreeViolation = 7,")

# Add detect_valley_free_violation to detect_route_leak
new_detect = """    fn detect_route_leak(&self, prefix: &str, ctx: &MessageContext) -> Option<LeakDetail> {
        let path = self.parse_path(&ctx.path_str);
        if path.len() < 3 {
            return None;
        }

        // 1. Valley-Free Violation: Customer to Provider to Provider/Peer
        for i in 0..path.len() - 2 {
            let (p1, p2, p3) = (path[i], path[i + 1], path[i + 2]);
            if (self.is_tier1(p1) || self.is_large_network(p1))
                && !self.is_tier1(p2)
                && (self.is_tier1(p3) || self.is_large_network(p3))
                && p1 != p3
                && p1 != p2
                && p2 != p3
            {
                return Some(LeakDetail {
                    leak_type: LeakType::ValleyFreeViolation, // Renamed from Hairpin since Hairpin is specifically when routing goes back to the same network
                    leaker_asn: p2,
                    victim_asn: p3,
                    leaker_as_name: self.get_as_name(p2).unwrap_or_default(),
                    victim_as_name: self.get_as_name(p3).unwrap_or_default(),
                    leaker_rpki_status: self.rpki_validate(p2, prefix),
                    victim_rpki_status: self.rpki_validate(p3, prefix),
                });
            }
        }

        // 2. Hairpin Turn: Route goes A -> B -> A
        for i in 0..path.len() - 2 {
            let (p1, p2, p3) = (path[i], path[i + 1], path[i + 2]);
            if p1 == p3 && p1 != p2 {
                 return Some(LeakDetail {
                    leak_type: LeakType::Hairpin,
                    leaker_asn: p2,
                    victim_asn: p1,
                    leaker_as_name: self.get_as_name(p2).unwrap_or_default(),
                    victim_as_name: self.get_as_name(p1).unwrap_or_default(),
                    leaker_rpki_status: self.rpki_validate(p2, prefix),
                    victim_rpki_status: self.rpki_validate(p1, prefix),
                });
            }
        }

        None
    }"""

content = re.sub(r'fn detect_route_leak.*?None\n    }', new_detect, content, flags=re.DOTALL)

with open("src/classifier.rs", "w") as f:
    f.write(content)
