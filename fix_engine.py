import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = content.replace("""	loadingHistorical      bool
	topStatsFlappiestASN     string""", """	loadingHistorical      bool
	topStatsFlappiestPrefix  string
	topStatsFlappiestASN     string""")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
