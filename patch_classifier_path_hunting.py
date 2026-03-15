import re

with open("src/classifier.rs", "r") as f:
    content = f.read()

# Current path hunting heuristic:
#        if s.unique_hosts.len() >= 3
#            && (s.path_len_inc >= 1 || s.path_len_dec >= 1)
#            && s.path_changes >= 4

# Adjusted path hunting heuristic:
#        if s.unique_hosts.len() >= 2
#            && (s.path_len_inc >= 1 || s.path_len_dec >= 1)
#            && s.path_changes >= 2
content = re.sub(
    r'if s\.unique_hosts\.len\(\) >= 3\s+&& \(s\.path_len_inc >= 1 \|\| s\.path_len_dec >= 1\)\s+&& s\.path_changes >= 4',
    'if s.unique_hosts.len() >= 2\n            && (s.path_len_inc >= 1 || s.path_len_dec >= 1)\n            && s.path_changes >= 2',
    content
)

with open("src/classifier.rs", "w") as f:
    f.write(content)
