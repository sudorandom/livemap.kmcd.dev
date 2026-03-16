package bgpengine

import "image/color"

var (
	ColorGossip = color.RGBA{0, 191, 255, 255} // Deep Sky Blue (Discovery)
	ColorNew    = color.RGBA{57, 255, 20, 255} // Hacker Green
	ColorUpd    = color.RGBA{148, 0, 211, 255} // Deep Violet/Purple (Policy Churn)
	ColorWith   = color.RGBA{255, 50, 50, 255} // Red (Withdrawal / Outage)

	// Level 2 - Cool/Neutral (Good/Normalish)
	ColorDiscovery = color.RGBA{0, 191, 255, 255} // Deep Sky Blue (Normal)
	ColorPolicy    = color.RGBA{148, 0, 211, 255} // Deep Violet/Purple (Normal)
	ColorBad       = color.RGBA{255, 127, 0, 255} // Orange (Bad)
	ColorCritical  = color.RGBA{255, 0, 0, 255}   // Pure Red (Critical)

	// Keep specific pulse colors for variety but group by tier color in legend
	ColorLinkFlap       = color.RGBA{255, 127, 0, 255}
	ColorOutage         = color.RGBA{255, 50, 50, 255}
	ColorLeak           = color.RGBA{255, 0, 0, 255}
	ColorNextHop        = color.RGBA{218, 165, 32, 255}
	ColorAggFlap        = color.RGBA{255, 140, 0, 255}
	ColorOscill         = color.RGBA{148, 0, 211, 255}
	ColorHunting        = color.RGBA{148, 0, 211, 255}
	ColorDDoSMitigation = color.RGBA{148, 0, 211, 255} // Purple (Policy)

	// Lighter versions for UI text and trendlines
	ColorGossipUI         = color.RGBA{135, 206, 250, 255} // Light Sky Blue
	ColorNewUI            = color.RGBA{152, 255, 152, 255} // Light Green
	ColorUpdUI            = color.RGBA{218, 112, 214, 255} // Orchid (Lighter Purple)
	ColorWithUI           = color.RGBA{255, 127, 127, 255} // Light Red
	ColorDDoSMitigationUI = color.RGBA{218, 112, 214, 255} // Orchid (Lighter Purple)

	ColorNote = color.RGBA{255, 255, 255, 255} // White
	ColorPeer = color.RGBA{255, 255, 0, 255}   // Yellow
	ColorOpen = color.RGBA{0, 100, 255, 255}   // Blue
)
