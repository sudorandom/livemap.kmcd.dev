import subprocess

def fix_map():
    subprocess.run(["git", "checkout", "HEAD", "--", "src/map.rs"])

def fix_db():
    subprocess.run(["git", "checkout", "HEAD", "--", "src/db.rs"])

def fix_main():
    with open('src/main.rs', 'r') as f:
        code = f.read()

    # Revert specific let_chains in main.rs
    code = code.replace("""                if let Some(fresh_bgpkit) = fresh_bgpkit_opt
                    && let Some(mut c_bg) = classifier_bg.bgpkit.try_write()
                {
                    info!("Applying fresh BGPKIT AS info.");
                    *c_bg = Some(fresh_bgpkit);
                }""", """                if let Some(fresh_bgpkit) = fresh_bgpkit_opt {
                    if let Some(mut c_bg) = classifier_bg.bgpkit.try_write() {
                        info!("Applying fresh BGPKIT AS info.");
                        *c_bg = Some(fresh_bgpkit);
                    }
                }""")

    code = code.replace("""                    if let Some(bgpkit) = &*c_stats.bgpkit.read()
                        && let Ok(Some(info)) = bgpkit.asinfo_get(ts.flappiest_asn)
                    {
                        if let Some(org) = info.as2org {
                            flappiest_org = org.org_name.clone();
                        } else if !info.name.is_empty() {
                            flappiest_org = info.name.clone();
                        }
                    }""", """                    if let Some(bgpkit) = &*c_stats.bgpkit.read() {
                        if let Ok(Some(info)) = bgpkit.asinfo_get(ts.flappiest_asn) {
                            if let Some(org) = info.as2org {
                                flappiest_org = org.org_name.clone();
                            } else if !info.name.is_empty() {
                                flappiest_org = info.name.clone();
                            }
                        }
                    }""")

    code = code.replace("""                                if let Some(bgpkit) = bgpkit_opt
                                    && let Ok(Some(info)) = bgpkit.asinfo_get(o_asn)
                                {
                                    if let Some(org) = info.as2org {
                                        o_name = org.org_name.clone();
                                    } else if !info.name.is_empty() {
                                        o_name = info.name.clone();
                                    }
                                }""", """                                if let Some(bgpkit) = bgpkit_opt {
                                    if let Ok(Some(info)) = bgpkit.asinfo_get(o_asn) {
                                        if let Some(org) = info.as2org {
                                            o_name = org.org_name.clone();
                                        } else if !info.name.is_empty() {
                                            o_name = info.name.clone();
                                        }
                                    }
                                }""")

    code = code.replace("""                                if rpki_loaded
                                    && let Some(bgpkit) = bgpkit_opt
                                {
                                    if let Ok(status) = bgpkit.rpki_validate(o_asn, &p_str) {
                                        match status {
                                            bgpkit_commons::rpki::RpkiValidation::Valid => {
                                                rpki_valid.push(v4)
                                            }
                                            bgpkit_commons::rpki::RpkiValidation::Invalid => {
                                                rpki_invalid.push(v4)
                                            }
                                            bgpkit_commons::rpki::RpkiValidation::Unknown => {
                                                rpki_missing.push(v4)
                                            }
                                        }
                                    } else {
                                        // Either malformed prefix string or something else, but since
                                        // we already checked rpki_loaded, we assume it's just unknown/invalid
                                        rpki_missing.push(v4);
                                    }
                                }""", """                                if rpki_loaded {
                                    if let Some(bgpkit) = bgpkit_opt {
                                        if let Ok(status) = bgpkit.rpki_validate(o_asn, &p_str) {
                                            match status {
                                                bgpkit_commons::rpki::RpkiValidation::Valid => {
                                                    rpki_valid.push(v4)
                                                }
                                                bgpkit_commons::rpki::RpkiValidation::Invalid => {
                                                    rpki_invalid.push(v4)
                                                }
                                                bgpkit_commons::rpki::RpkiValidation::Unknown => {
                                                    rpki_missing.push(v4)
                                                }
                                            }
                                        } else {
                                            // Either malformed prefix string or something else, but since
                                            // we already checked rpki_loaded, we assume it's just unknown/invalid
                                            rpki_missing.push(v4);
                                        }
                                    }
                                }""")

    with open('src/main.rs', 'w') as f:
        f.write(code)

fix_map()
fix_db()
fix_main()
