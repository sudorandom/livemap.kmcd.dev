import re

with open("src/main.rs", "r") as f:
    content = f.read()

content = content.replace("""                                alerts.push(Alert {
                                    alert_type: AlertType::ByAsn.into(),
                                    location: None,
                                                            country: String::new(),""", """                                alerts.push(Alert {
                                    alert_type: AlertType::ByAsn.into(),
                                    location: None,
                                    asn,
                                    country: String::new(),""")

with open("src/main.rs", "w") as f:
    f.write(content)
