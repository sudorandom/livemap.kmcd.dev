file_path = "src/classifier.rs"
with open(file_path, "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "if let Some(customers) = db.get(&provider) && customers.contains(&customer) {" in line:
        lines[i] = "        if let Some(customers) = db.get(&provider) {\n            if customers.contains(&customer) {\n                return true;\n            }\n        }\n"
        lines[i+1] = ""
        break

with open(file_path, "w") as f:
    f.writelines(lines)
