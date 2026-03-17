import re

with open("src/main.rs", "r") as f:
    content = f.read()

patterns = [
    r"#\[derive\(Clone\)\]\n#\[allow\(dead_code\)\]\n",
    r"#\[derive\(Default\)\]\n",
    r"#\[derive\(Clone, Hash, Eq, PartialEq\)\]\n"
]

for pattern in patterns:
    content = re.sub(pattern, "", content, count=1)

with open("src/main.rs", "w") as f:
    f.write(content)
