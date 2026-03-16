import re

with open("src/classifier.rs", "r") as f:
    content = f.read()

# Fix first error
content = content.replace("        if historical_origin_asn != 0\n            && ctx.origin_asn != 0\n            && ctx.origin_asn != historical_origin_asn\n            && !self.is_likely_sibling(ctx.origin_asn, historical_origin_asn)\n        {\n            if self.rpki_validate(ctx.origin_asn, prefix) != 1 {",
                          "        if historical_origin_asn != 0\n            && ctx.origin_asn != 0\n            && ctx.origin_asn != historical_origin_asn\n            && !self.is_likely_sibling(ctx.origin_asn, historical_origin_asn)\n            && self.rpki_validate(ctx.origin_asn, prefix) != 1\n        {")

# Delete extra bracket
c_idx = content.find("&& self.rpki_validate(ctx.origin_asn, prefix) != 1")
end_idx = content.find("            }", c_idx)
# This one is tricky, let's just use regular expressions or simpler logic. Let's try to just run cargo clippy --fix

with open("src/classifier.rs", "w") as f:
    pass
