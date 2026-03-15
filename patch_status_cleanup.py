import re

with open("pkg/bgpengine/status.go", "r") as f:
    content = f.read()

# remove remaining draw trend layers calls
content = re.sub(r'func \(e \*Engine\) drawIPTrendLayers.*?(?=func \(e \*Engine\) StartMetricsLoop)', '', content, flags=re.DOTALL)
content = re.sub(r'func \(e \*Engine\) drawTrendGrid.*?(?=func \(e \*Engine\) drawTrendLayers)', '', content, flags=re.DOTALL)
content = re.sub(r'func \(e \*Engine\) drawTrendLayers.*?(?=func \(e \*Engine\) StartMetricsLoop)', '', content, flags=re.DOTALL)
content = re.sub(r'func \(e \*Engine\) calculateGlobalLogBounds.*?(?=func \(e \*Engine\) calculateGlobalIPBounds)', '', content, flags=re.DOTALL)
content = re.sub(r'func \(e \*Engine\) calculateGlobalIPBounds.*?(?=func \(e \*Engine\) drawIPTrendLayers)', '', content, flags=re.DOTALL)

with open("pkg/bgpengine/status.go", "w") as f:
    f.write(content)
