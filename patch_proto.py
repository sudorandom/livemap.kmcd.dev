import re

# Update proto definition
with open("proto/livemap/v1/livemap.proto", "r") as f:
    content = f.read()

content = content.replace("CLASSIFICATION_DISCOVERY = 9;", "CLASSIFICATION_DISCOVERY = 9;\n    CLASSIFICATION_MINOR_ROUTE_LEAK = 10;")

with open("proto/livemap/v1/livemap.proto", "w") as f:
    f.write(content)

# Update Go frontend types and mappers
with open("pkg/bgp/types.go", "r") as f:
    content = f.read()

content = content.replace('NameRouteLeak      = "Route Leak"', 'NameRouteLeak      = "Route Leak"\n\tNameMinorRouteLeak = "Minor Route Leak"')
content = content.replace('ClassificationRouteLeak', 'ClassificationRouteLeak\n\tClassificationMinorRouteLeak')
content = content.replace('case ClassificationRouteLeak:\n\t\treturn NameRouteLeak', 'case ClassificationRouteLeak:\n\t\treturn NameRouteLeak\n\tcase ClassificationMinorRouteLeak:\n\t\treturn NameMinorRouteLeak')

with open("pkg/bgp/types.go", "w") as f:
    f.write(content)

with open("pkg/livemap/v1/livemap.pb.go", "r") as f:
    content = f.read()

content = content.replace('Classification_CLASSIFICATION_DISCOVERY    Classification = 9', 'Classification_CLASSIFICATION_DISCOVERY    Classification = 9\n\tClassification_CLASSIFICATION_MINOR_ROUTE_LEAK Classification = 10')
content = content.replace('9: "CLASSIFICATION_DISCOVERY",', '9: "CLASSIFICATION_DISCOVERY",\n\t\t10: "CLASSIFICATION_MINOR_ROUTE_LEAK",')
content = content.replace('"CLASSIFICATION_DISCOVERY":    9,', '"CLASSIFICATION_DISCOVERY":    9,\n\t\t"CLASSIFICATION_MINOR_ROUTE_LEAK": 10,')

with open("pkg/livemap/v1/livemap.pb.go", "w") as f:
    f.write(content)
