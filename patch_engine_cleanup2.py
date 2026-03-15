import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# remove initializations
content = re.sub(r'\t*e\.trendLineImg = ebiten\.NewImage\(1, 1\)\n\t*e\.trendLineImg\.Fill\(color\.White\)\n', '', content)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)

with open("pkg/bgpengine/status.go", "r") as f:
    content2 = f.read()

# check if trend functions are fully gone
if "drawIPTrendlines" in content2:
    print("WARNING: drawIPTrendlines still present")
