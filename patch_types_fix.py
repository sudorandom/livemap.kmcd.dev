import re

with open("pkg/bgp/types.go", "r") as f:
    content = f.read()

content = content.replace('case ClassificationRouteLeak\n\t\tClassificationMinorRouteLeak:', 'case ClassificationRouteLeak, ClassificationMinorRouteLeak:')
content = content.replace('case ClassificationRouteLeak\n\tClassificationMinorRouteLeak:', 'case ClassificationRouteLeak, ClassificationMinorRouteLeak:')

with open("pkg/bgp/types.go", "w") as f:
    f.write(content)
