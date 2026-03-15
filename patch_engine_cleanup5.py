import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = re.sub(r'func \(e \*Engine\) InitTrendlineTexture\(\) \{.*?(?=// StartBufferLoop)', '', content, flags=re.DOTALL)
content = re.sub(r'e\.InitTrendlineTexture\(\)\n', '', content)

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
