import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = re.sub(r'e\.trendCircleImg = ebiten\.NewImage\(30, 30\)\n\s+vector\.DrawFilledCircle\(e\.trendCircleImg, 15, 15, 15, color\.White, true\)\n', '', content)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
