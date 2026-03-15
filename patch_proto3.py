import re

with open("pkg/livemap/livemap.pb.go", "r") as f:
    content = f.read()

content = content.replace('Classification_CLASSIFICATION_DISCOVERY    Classification = 9', 'Classification_CLASSIFICATION_DISCOVERY    Classification = 9\n\tClassification_CLASSIFICATION_MINOR_ROUTE_LEAK Classification = 10')
content = content.replace('9: "CLASSIFICATION_DISCOVERY",', '9: "CLASSIFICATION_DISCOVERY",\n\t\t10: "CLASSIFICATION_MINOR_ROUTE_LEAK",')
content = content.replace('"CLASSIFICATION_DISCOVERY":    9,', '"CLASSIFICATION_DISCOVERY":    9,\n\t\t"CLASSIFICATION_MINOR_ROUTE_LEAK": 10,')

with open("pkg/livemap/livemap.pb.go", "w") as f:
    f.write(content)
