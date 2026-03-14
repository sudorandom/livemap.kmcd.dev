import re

with open("src/classifier.rs", "r") as f:
    content = f.read()

# Fix detect_route_leak
leak_orig = """                return Some(LeakDetail {
                    leak_type: LeakType::Hairpin,
                    leaker_asn: p2,
                    victim_asn: p3,
                    leaker_as_name: self.get_as_name(p2).unwrap_or_default(),
                    victim_as_name: self.get_as_name(p3).unwrap_or_default(),
                    leaker_rpki_status: self.rpki_validate(p2, prefix),
                    victim_rpki_status: self.rpki_validate(p3, prefix),
                });"""

leak_new = """                let leaker_rpki_status = self.rpki_validate(p2, prefix);
                let victim_rpki_status = self.rpki_validate(p3, prefix);
                if (victim_rpki_status == 1 || victim_rpki_status == 2) && (leaker_rpki_status != 1 && leaker_rpki_status != 2) {
                    return Some(LeakDetail {
                        leak_type: LeakType::Hairpin,
                        leaker_asn: p2,
                        victim_asn: p3,
                        leaker_as_name: self.get_as_name(p2).unwrap_or_default(),
                        victim_as_name: self.get_as_name(p3).unwrap_or_default(),
                        leaker_rpki_status,
                        victim_rpki_status,
                    });
                }"""
content = content.replace(leak_orig, leak_new)

# Fix get_as_name
name_orig = """    pub fn get_as_name(&self, asn: u32) -> Option<String> {
        if asn == 0 {
            return None;
        }
        {
            let cache = self.bgpkit_cache.lock();
            if let Some(res) = cache.as2name.get(&asn) {
                return res.clone();
            }
        }
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard {
            let name = bgpkit.asinfo_get(asn).ok().flatten().map(|i| i.name);

            if name.is_none() {
                debug!("AS name not found for AS{}", asn);
            }

            let mut cache = self.bgpkit_cache.lock();
            cache.as2name.insert(asn, name.clone());
            return name;
        }
        None
    }"""
name_new = """    pub fn get_as_name(&self, asn: u32) -> Option<String> {
        if asn == 0 {
            return None;
        }
        {
            let cache = self.bgpkit_cache.lock();
            if let Some(res) = cache.as2name.get(&asn) {
                return res.clone();
            }
        }
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard {
            let name = bgpkit.asinfo_get(asn).ok().flatten().map(|i| i.name);

            if name.is_none() {
                debug!("AS name not found for AS{}", asn);
            }

            if name.is_some() {
                let mut cache = self.bgpkit_cache.lock();
                cache.as2name.insert(asn, name.clone());
            }
            return name;
        }
        None
    }"""
content = content.replace(name_orig, name_new)

# Fix get_as_org
org_orig = """    fn get_as_org(&self, asn: u32) -> Option<String> {
        {
            let cache = self.bgpkit_cache.lock();
            if let Some(res) = cache.as2org.get(&asn) {
                return res.clone();
            }
        }
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard {
            let org = bgpkit
                .asinfo_get(asn)
                .ok()
                .flatten()
                .and_then(|i| i.as2org.clone().map(|o| o.org_name));
            let mut cache = self.bgpkit_cache.lock();
            cache.as2org.insert(asn, org.clone());
            return org;
        }
        None
    }"""
org_new = """    fn get_as_org(&self, asn: u32) -> Option<String> {
        {
            let cache = self.bgpkit_cache.lock();
            if let Some(res) = cache.as2org.get(&asn) {
                return res.clone();
            }
        }
        let bgpkit_guard = self.bgpkit.read();
        if let Some(ref bgpkit) = *bgpkit_guard {
            let org = bgpkit
                .asinfo_get(asn)
                .ok()
                .flatten()
                .and_then(|i| i.as2org.clone().map(|o| o.org_name));
            if org.is_some() {
                let mut cache = self.bgpkit_cache.lock();
                cache.as2org.insert(asn, org.clone());
            }
            return org;
        }
        None
    }"""
content = content.replace(org_orig, org_new)

# Fix upsert_prefix_state inside classify_event
orig2 = """            } else if (ctx.is_withdrawal || state.classified_type != old_classified_type)
                && let Ok(data) = serde_json::to_string(&state)
            {
                let p_asn = if ctx.origin_asn != 0 {
                    ctx.origin_asn
                } else {
                    state.historical_origin_asn
                };
                db.upsert_prefix_state(
                    &prefix,
                    &data,
                    state.last_update_ts,
                    state.classified_type as i32,
                    p_asn,
                );
            }"""

new_ver2 = """            } else if (ctx.is_withdrawal || state.classified_type != old_classified_type)
                && let Ok(data) = serde_json::to_string(&state)
            {
                let p_asn = if ctx.origin_asn != 0 {
                    ctx.origin_asn
                } else if state.last_origin_asn != 0 {
                    state.last_origin_asn
                } else {
                    state.historical_origin_asn
                };
                db.upsert_prefix_state(
                    &prefix,
                    &data,
                    state.last_update_ts,
                    state.classified_type as i32,
                    p_asn,
                );
            }"""
content = content.replace(orig2, new_ver2)

with open("src/classifier.rs", "w") as f:
    f.write(content)
