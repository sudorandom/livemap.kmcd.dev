import re

with open("pkg/bgpengine/engine_bench_test.go", "r") as f:
    content = f.read()

content = content.replace("e.InitTrendlineTexture()", "")
content = re.sub(r'func BenchmarkDrawTrendGrid.*?(?=func BenchmarkAggregateMetrics)', '', content, flags=re.DOTALL)

with open("pkg/bgpengine/engine_bench_test.go", "w") as f:
    f.write(content)
