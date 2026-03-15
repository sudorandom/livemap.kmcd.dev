import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = content.replace('bgp.LeakNone', 'bgp.LeakUnknown')
content = content.replace('\te.trendCircleImg = ebiten.NewImage(30, 30)\n\tvector.DrawFilledCircle(e.trendCircleImg, 15, 15, 15, color.White, true)\n', '')

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
