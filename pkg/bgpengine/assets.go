// Package bgpengine provides the core logic for the BGP stream engine.
package bgpengine

import _ "embed"

//go:embed data/world.geo.json
var worldGeoJSON []byte

//go:embed fonts/Inter/static/Inter_24pt-Medium.ttf
var fontInter []byte

//go:embed fonts/Roboto_Mono/static/RobotoMono-Medium.ttf
var fontMono []byte
