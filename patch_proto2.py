import re
with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = content.replace("ct != bgp.ClassificationRouteLeak &&", "ct != bgp.ClassificationRouteLeak && ct != bgp.ClassificationMinorRouteLeak &&")
content = content.replace("case bgp.NameRouteLeak:", "case bgp.NameRouteLeak, bgp.NameMinorRouteLeak:")
content = content.replace("ce.Anom == bgp.NameRouteLeak", "(ce.Anom == bgp.NameRouteLeak || ce.Anom == bgp.NameMinorRouteLeak)")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)

with open("pkg/bgpengine/status.go", "r") as f:
    content2 = f.read()

content2 = content2.replace("ce.Anom == bgp.NameRouteLeak", "(ce.Anom == bgp.NameRouteLeak || ce.Anom == bgp.NameMinorRouteLeak)")
content2 = content2.replace("case bgp.NameRouteLeak:", "case bgp.NameRouteLeak, bgp.NameMinorRouteLeak:")

with open("pkg/bgpengine/status.go", "w") as f:
    f.write(content2)

with open("pkg/bgpengine/assets.go", "r") as f:
    content3 = f.read()

content3 = content3.replace("case bgp.ClassificationRouteLeak:", "case bgp.ClassificationRouteLeak:\n\t\treturn ColorLeak, ColorLeak, ShapeSquare\n\tcase bgp.ClassificationMinorRouteLeak:")

with open("pkg/bgpengine/assets.go", "w") as f:
    f.write(content3)
