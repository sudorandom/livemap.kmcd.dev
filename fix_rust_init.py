import re

with open("src/main.rs", "r") as f:
    content = f.read()

content = content.replace("""        let flappiest_asn = self.state.top_flappiest_asn.read().await.clone();
        let flappiest_network = self.state.top_flappiest_network.read().await.clone();""", """        let flappiest_prefix = self.state.top_flappiest_prefix.read().await.clone();
        let flappiest_asn = self.state.top_flappiest_asn.read().await.clone();
        let flappiest_network = self.state.top_flappiest_network.read().await.clone();""")

content = content.replace("""            flappiest_asn_str: flappiest_asn,
            flappiest_network,""", """            flappiest_prefix,
            flappiest_asn_str: flappiest_asn,
            flappiest_network,""")

with open("src/main.rs", "w") as f:
    f.write(content)
