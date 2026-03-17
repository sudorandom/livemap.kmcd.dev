package bgpengine

import (
	"image/color"
	"time"

	"github.com/sudorandom/bgp-stream/pkg/bgp"
)

type EventShape int

const (
	ShapeCircle EventShape = iota
	ShapeFlare
	ShapeSquare
)

type Pulse struct {
	X, Y      float64
	StartTime time.Time
	Duration  time.Duration
	Color     color.RGBA
	MaxRadius float64
	Shape     EventShape
}

type QueuedPulse struct {
	Lat, Lng      float64
	Type          bgp.EventType
	Color         color.RGBA
	Count         int
	ScheduledTime time.Time
	Shape         EventShape
}

type PulseKey struct {
	Color color.RGBA
	Shape EventShape
}

type BufferedCity struct {
	Lat, Lng float64
	Counts   map[PulseKey]int
}

type asnGroupKey struct {
	ASN  uint32
	Anom string
}

type CriticalEvent struct {
	Timestamp  time.Time
	Anom       string
	ASN        uint32
	ASNStr     string
	OrgID      string
	LeakType   bgp.LeakType
	LeakerASN  uint32
	LeakerName string
	LeakerRPKI int32
	VictimASN  uint32
	VictimName string
	VictimRPKI int32
	Locations  string
	Country    string
	Color      color.RGBA
	UIColor    color.RGBA
	IsAggregate bool

	ImpactedIPs       uint64
	ImpactedPrefixes  map[string]struct{}
	ActivePrefixes    map[string]struct{}
	ActiveIncidentIDs map[string]struct{}
	Resolved          bool

	// Pre-rendered layout values
	CachedTypeLabel string
	CachedTypeWidth float64
	CachedFirstLine string

	CachedLeakerLabel string
	CachedLeakerVal   string
	CachedVictimLabel string
	CachedVictimVal   string
	CachedASNLabel    string
	CachedASNVal      string
	CachedNetLabel    string
	CachedNetVal      string
	CachedLocLabel    string
	CachedLocVal      string

	CachedImpactStr string
}

type statsEvent struct {
	ev         *bgpEvent
	name       string
	c          color.RGBA
	uiInterval float64
	trigger    bool
}

type bgpEvent struct {
	lat, lng           float64
	cc                 string
	city               string
	eventType          bgp.EventType
	classificationType bgp.ClassificationType
	prefix             string
	asn                uint32
	historicalASN      uint32
	leakDetail         *bgp.LeakDetail
	anomalyDetails     *bgp.AnomalyDetails
}

type VisualHub struct {
	CC          string
	CountryStr  string
	Rate        float64
	RateStr     string
	RateWidth   float64
	DisplayY    float64
	TargetY     float64
	Alpha       float32
	TargetAlpha float32
	Active      bool
}

type PrefixCount struct {
	Name         string
	Type         bgp.ClassificationType
	MsgCount     int
	MsgStr       string
	ASNCount     int
	ASNStr       string
	PfxCount     int
	PfxStr       string
	IPv4PfxCount int
	IPv4PfxStr   string
	IPv6PfxCount int
	IPv6PfxStr   string
	IPCount      uint64
	IPStr        string
	Rate         float64
	RateStr      string
	Color        color.RGBA
	Priority     int

	// Pre-calculated widths
	RateWidth    float64
	ASNWidth     float64
	PfxWidth     float64
	IPv4PfxWidth float64
	IPv6PfxWidth float64
	IPWidth      float64
}

type ASNImpact struct {
	ASNStr    string
	Prefixes  []string
	MoreStr   string
	Anom      string
	AnomWidth float64
	Color     color.RGBA
	Count     int
	Rate      float64

	LeakType  bgp.LeakType
	LeakerASN uint32
	VictimASN uint32
	Locations string
}

type VisualImpact struct {
	Prefix                     string
	MaskLen                    int
	ASN                        uint32
	NetworkName                string
	ClassificationName         string
	ClassificationColor        color.RGBA
	DisplayClassificationName  string
	DisplayClassificationColor color.RGBA
	Count                      float64
	RateStr                    string
	RateWidth                  float64
	DisplayY                   float64
	TargetY                    float64
	Alpha                      float32
	TargetAlpha                float32
	Active                     bool

	LeakType  bgp.LeakType
	LeakerASN uint32
	VictimASN uint32
	CCs       map[string]struct{}
}

type MetricSnapshot struct {
	New, Upd, With, Gossip, Note, Peer, Open float64
	Beacon, Honeypot, Research, Security     float64

	Flap, Oscill                                           float64
	Hunting, NextHop, Outage                               float64
	Leak, Hijack, Bogon, Attr, Global, DDoS, Dedupe, Uncat float64

	GoodIPs, PolyIPs, BadIPs, CritIPs uint64
}

type asnGroup struct {
	asnStr     string
	prefixes   []string
	anom       string
	color      color.RGBA
	priority   int
	maxCount   float64
	totalCount float64

	leakType  bgp.LeakType
	leakerASN uint32
	victimASN uint32
	locations map[string]struct{}
}
