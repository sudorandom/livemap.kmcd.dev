import re

with open("pkg/bgpengine/engine_bench_test.go", "r") as f:
    content = f.read()

content = re.sub(r'func BenchmarkDrawTrendGrid.*?\n}\n', '', content, flags=re.DOTALL)

with open("pkg/bgpengine/engine_bench_test.go", "w") as f:
    f.write(content)
