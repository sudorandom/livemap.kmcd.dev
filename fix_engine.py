import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# I messed up by leaving the old RecordAlert function, let me find the old one and replace it properly.
# Wait, I used `replace`, it probably didn't replace because of some whitespace.

old_func_start = "func (e *Engine) RecordAlert(alert *livemap.Alert) {"
func_pattern = r'func \(e \*Engine\) RecordAlert\(alert \*livemap\.Alert\) \{.*?\n\}'
# Find the actual function text to replace
matches = re.findall(r'(func \(e \*Engine\) RecordAlert\(alert \*livemap\.Alert\) \{.*?\n\})', content, flags=re.DOTALL)

# Let me check if there are multiple `RecordAlert`
if len(matches) > 1:
    print(f"Found {len(matches)} RecordAlert functions.")
else:
    print("Found 1 RecordAlert.")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
