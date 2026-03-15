import re

with open("pkg/bgpengine/assets.go", "r") as f:
    content = f.read()

content = content.replace('ClassificationMinorRouteLeak', 'ClassificationRouteLeak')
content = content.replace("case bgp.ClassificationRouteLeak:\n\t\treturn ColorLeak, ColorLeak, ShapeSquare\n\tcase bgp.ClassificationRouteLeak:", "case bgp.ClassificationRouteLeak:\n\t\treturn ColorLeak, ColorLeak, ShapeSquare\n\tcase bgp.ClassificationMinorRouteLeak:")

with open("pkg/bgpengine/assets.go", "w") as f:
    f.write(content)
