import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Add #[allow(dead_code)] to WindowEntry to prevent the warning instead of deleting asn
content = content.replace("struct WindowEntry {", "#[allow(dead_code)]\nstruct WindowEntry {")
content = content.replace("    fn add_event(", "    #[allow(clippy::too_many_arguments)]\n    fn add_event(")

with open("src/main.rs", "w") as f:
    f.write(content)
