import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# I used maxCriticalEvents but maybe it's maxPersistentEvents or something
# Let's check what the old RecordAlert had.
# I can restore engine.go and check it.
