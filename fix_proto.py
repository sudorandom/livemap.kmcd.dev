import re

with open("proto/livemap/v1/livemap.proto", "r") as f:
    content = f.read()

content = content.replace("""    string flappiest_asn_str = 15;
    string flappiest_network = 16;
    uint32 flappy_prefix_count = 17;""", """    string flappiest_asn_str = 15;
    string flappiest_network = 16;
    uint32 flappy_prefix_count = 17;
    string flappiest_prefix = 23;""")

with open("proto/livemap/v1/livemap.proto", "w") as f:
    f.write(content)
