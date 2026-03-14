import re

file_path = "src/classifier.rs"
with open(file_path, "r") as f:
    content = f.read()

content = content.replace('s.unique_hosts.len() >= 1', '!s.unique_hosts.is_empty()')
content = content.replace('''        if let Some(customers) = db.get(&provider) {
            if customers.contains(&customer) {
                return true;
            }
        }''', '''        if let Some(customers) = db.get(&provider) {
            if customers.contains(&customer) {
                return true;
            }
        }''') # I will fix this manually to avoid replacing too much

with open(file_path, "w") as f:
    f.write(content)
