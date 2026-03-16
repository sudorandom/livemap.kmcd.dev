#!/bin/bash
sed -i '/type EventShape int/,/type asnGroup struct {/d' pkg/bgpengine/engine.go
sed -i '/type point struct{ x, y float64 }/d' pkg/bgpengine/engine.go
sed -i '/var (/d' pkg/bgpengine/engine.go
sed -i '/ColorGossip =/d' pkg/bgpengine/engine.go
sed -i '/ColorNew    =/d' pkg/bgpengine/engine.go
sed -i '/ColorUpd    =/d' pkg/bgpengine/engine.go
sed -i '/ColorWith   =/d' pkg/bgpengine/engine.go
sed -i '/\/\/ Level 2 - Cool\/Neutral (Good\/Normalish)/d' pkg/bgpengine/engine.go
sed -i '/ColorDiscovery =/d' pkg/bgpengine/engine.go
sed -i '/ColorPolicy    =/d' pkg/bgpengine/engine.go
sed -i '/ColorBad       =/d' pkg/bgpengine/engine.go
sed -i '/ColorCritical  =/d' pkg/bgpengine/engine.go
sed -i '/\/\/ Keep specific pulse colors for variety but group by tier color in legend/d' pkg/bgpengine/engine.go
sed -i '/ColorLinkFlap       =/d' pkg/bgpengine/engine.go
sed -i '/ColorOutage         =/d' pkg/bgpengine/engine.go
sed -i '/ColorLeak           =/d' pkg/bgpengine/engine.go
sed -i '/ColorNextHop        =/d' pkg/bgpengine/engine.go
sed -i '/ColorAggFlap        =/d' pkg/bgpengine/engine.go
sed -i '/ColorOscill         =/d' pkg/bgpengine/engine.go
sed -i '/ColorHunting        =/d' pkg/bgpengine/engine.go
sed -i '/ColorDDoSMitigation =/d' pkg/bgpengine/engine.go
sed -i '/\/\/ Lighter versions for UI text and trendlines/d' pkg/bgpengine/engine.go
sed -i '/ColorGossipUI         =/d' pkg/bgpengine/engine.go
sed -i '/ColorNewUI            =/d' pkg/bgpengine/engine.go
sed -i '/ColorUpdUI            =/d' pkg/bgpengine/engine.go
sed -i '/ColorWithUI           =/d' pkg/bgpengine/engine.go
sed -i '/ColorDDoSMitigationUI =/d' pkg/bgpengine/engine.go
sed -i '/ColorNote =/d' pkg/bgpengine/engine.go
sed -i '/ColorPeer =/d' pkg/bgpengine/engine.go
sed -i '/ColorOpen =/d' pkg/bgpengine/engine.go
sed -i '/^)/d' pkg/bgpengine/engine.go
sed -i '/const (/d' pkg/bgpengine/engine.go
sed -i '/MaxActivePulses      = 30000/d' pkg/bgpengine/engine.go
sed -i '/MaxVisualQueueSize   = 500000/d' pkg/bgpengine/engine.go
sed -i '/DefaultPulsesPerTick = 500/d' pkg/bgpengine/engine.go
sed -i '/BurstPulsesPerTick   = 2000/d' pkg/bgpengine/engine.go
sed -i '/VisualQueueThreshold = 10000/d' pkg/bgpengine/engine.go
sed -i '/VisualQueueCull      = 100000/d' pkg/bgpengine/engine.go
