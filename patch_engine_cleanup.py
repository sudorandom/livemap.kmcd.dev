import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

# Remove buffers
content = re.sub(r'\t*trendLinesBuffer\s+\*ebiten\.Image\n', '', content)
content = re.sub(r'\t*trendClipBuffer\s+\*ebiten\.Image\n', '', content)
content = re.sub(r'\t*ipTrendLinesBuffer\s+\*ebiten\.Image\n', '', content)
content = re.sub(r'\t*ipTrendClipBuffer\s+\*ebiten\.Image\n', '', content)
content = re.sub(r'\t*trendGridVertices\s+\[\]ebiten\.Vertex\n', '', content)
content = re.sub(r'\t*trendGridIndices\s+\[\]uint16\n', '', content)
content = re.sub(r'\t*trendLineImg\s+\*ebiten\.Image\n', '', content)
content = re.sub(r'\t*trendCircleImg\s+\*ebiten\.Image\n', '', content)
content = re.sub(r'\t*lastIPTrendUpdate\s+time\.Time\n', '', content)
content = re.sub(r'\t*lastTrendUpdate\s+time\.Time\n', '', content)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
