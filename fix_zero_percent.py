import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Filter percentage increase in Backend
content = content.replace("if ipv4_count >= 5000 || ipv6_prefixes >= 20 {", "if (ipv4_count >= 5000 || ipv6_prefixes >= 20) && percentage_increase > 0.0 {")

with open("src/main.rs", "w") as f:
    f.write(content)
