import re

with open("src/main.rs", "r") as f:
    content = f.read()

content = content + "\n#[cfg(test)]\nmod stats_test;\n#[cfg(test)]\nmod rolling_windows_test;\n"

with open("src/main.rs", "w") as f:
    f.write(content)
