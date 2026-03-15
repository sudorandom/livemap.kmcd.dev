import re

with open("pkg/bgpengine/status.go", "r") as f:
    content = f.read()

content = content.replace('text.Draw(e.streamClipBuffer, "[RESOLVED] "+ce.CachedTypeLabel, e.subMonoFace, textOp)', 'text.Draw(e.streamClipBuffer, "[RESOLVED]"+ce.CachedTypeLabel, e.subMonoFace, textOp)')
content = content.replace('resolvedW, _ := text.Measure("[RESOLVED] ", e.subMonoFace, 0)', 'resolvedW, _ := text.Measure("[RESOLVED]", e.subMonoFace, 0)')

with open("pkg/bgpengine/status.go", "w") as f:
    f.write(content)
