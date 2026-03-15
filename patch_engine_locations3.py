import re

with open("pkg/bgpengine/engine.go", "r") as f:
    content = f.read()

content = content.replace('Locations:         func() string { if trans.Country != "" && trans.City != "" { return trans.City + ", " + trans.Country } else if trans.City != "" { return trans.City } return trans.Country }(),', 'Locations:         func() string { if trans.Country != "" && trans.City != "" { return trans.City + ", " + trans.Country }; if trans.City != "" { return trans.City }; return trans.Country }(),')

with open("pkg/bgpengine/engine.go", "w") as f:
    f.write(content)
