import re

with open("src/main.rs", "r") as f:
    content = f.read()

content = content.replace("""        top_flappiest_asn: RwLock::new(String::new()),
        top_flappiest_network: RwLock::new(String::new()),""", """        top_flappiest_prefix: RwLock::new(String::new()),
        top_flappiest_asn: RwLock::new(String::new()),
        top_flappiest_network: RwLock::new(String::new()),""")

with open("src/main.rs", "w") as f:
    f.write(content)
