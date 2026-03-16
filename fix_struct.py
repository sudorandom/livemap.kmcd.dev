import re

with open("src/main.rs", "r") as f:
    content = f.read()

# Fix double struct WindowEntry
content = re.sub(r'#\[derive\(Clone\)\]\nstruct WindowEntry \{.*?\}\n\n#\[derive\(Clone\)\]\nstruct WindowEntry \{.*?\}', """#[derive(Clone)]
struct WindowEntry {
    ts: i64,
    prefix: String,
    city: Option<String>,
    country: Option<String>,
    asn: u32,
    as_name: String,
}""", content, flags=re.DOTALL)

# Re-add missing fields if missing
if "asn: u32," not in content:
    content = content.replace("struct WindowEntry {", "struct WindowEntry {\n    asn: u32,")
    content = content.replace("            as_name: as_name.clone(),", "            asn,\n            as_name: as_name.clone(),")

# Fix missing asn in Check by Country
content = content.replace("                                    asn: 0,\n                                    country: country.clone(),", "                                    asn: 0,\n                                    country: country.clone(),") # Wait, is asn missing from country alert?
# By location has asn: 0, by Country has asn: 0, by ASN has asn

with open("src/main.rs", "w") as f:
    f.write(content)
