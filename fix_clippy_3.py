import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Add #[allow(clippy::too_many_arguments)] and remove dead code
content = content.replace("    asn: u32,\n", "")
content = content.replace("            asn,\n", "")
content = content.replace("    fn add_event(", "    #[allow(clippy::too_many_arguments)]\n    fn add_event(")

with open("src/main.rs", "w") as f:
    f.write(content)
