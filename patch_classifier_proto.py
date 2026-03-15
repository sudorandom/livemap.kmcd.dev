import re

with open("src/main.rs", "r") as f:
    content = f.read()

content = content.replace("ClassificationType::Discovery => ProtoClassification::Discovery,", "ClassificationType::Discovery => ProtoClassification::Discovery,\n        ClassificationType::MinorRouteLeak => ProtoClassification::MinorRouteLeak,")

with open("src/main.rs", "w") as f:
    f.write(content)
