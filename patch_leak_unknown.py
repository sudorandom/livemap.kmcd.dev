import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = content.replace("ce.LeakType != bgp.LeakUnknown && ce.LeakType != bgp.LeakUnknown", "ce.LeakType != bgp.LeakUnknown")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
