import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Fix type mismatch
content = content.replace("ce.LeakerRPKI = trans.LeakDetail.LeakerRpkiStatus", "ce.LeakerRPKI = int32(trans.LeakDetail.LeakerRpkiStatus)")
content = content.replace("ce.VictimRPKI = trans.LeakDetail.VictimRpkiStatus", "ce.VictimRPKI = int32(trans.LeakDetail.VictimRpkiStatus)")

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)

print("Fixed status type.")
