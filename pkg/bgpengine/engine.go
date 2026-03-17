// Package bgpengine provides the core logic for the BGP stream engine, including data processing and visualization.
package bgpengine

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"log"
	"math"
	"math/rand"
	"os"
	"os/exec"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/text/v2"
	geojson "github.com/paulmach/go.geojson"
	"github.com/sudorandom/bgp-stream/pkg/bgp"
	"github.com/sudorandom/bgp-stream/pkg/geoservice"
	livemap "github.com/sudorandom/bgp-stream/pkg/livemap/livemap/v1"
	"github.com/sudorandom/bgp-stream/pkg/utils"
)





type Engine struct {
	Width, Height int
	FPS           int
	Scale         float64

	pulses   []Pulse
	pulsesMu sync.Mutex

	geo *geoservice.GeoService

	cityBuffer         map[uint64]*BufferedCity
	cityBufferPool     sync.Pool
	bufferMu           sync.Mutex
	visualQueue        []QueuedPulse
	queueMu            sync.Mutex
	nextPulseEmittedAt time.Time

	bgImage        *ebiten.Image
	pulseImage     *ebiten.Image
	flareImage     *ebiten.Image
	squareImage    *ebiten.Image
	whitePixel     *ebiten.Image
	fadeMask       *ebiten.Image
	fontSource     *text.GoTextFaceSource
	monoSource     *text.GoTextFaceSource

	displayBeaconPercent                   float64

	countryActivity map[string]int

	// History for trendlines (last 60 snapshots, 2s each = 2 mins)
	history        []MetricSnapshot
	latestSnapshot MetricSnapshot
	metricsMu      sync.RWMutex

	CurrentSong        string
	CurrentArtist      string
	CurrentExtra       string
	songChangedAt      time.Time
	songBuffer         *ebiten.Image
	artistBuffer       *ebiten.Image
	extraBuffer        *ebiten.Image
	impactBuffer       *ebiten.Image
	streamBuffer       *ebiten.Image
	streamClipBuffer   *ebiten.Image
	nowPlayingBuffer   *ebiten.Image
	nowPlayingDirty    bool


	hubChangedAt map[string]time.Time
	lastHubs     map[string]int
	hubPosition  map[string]int

	IsConnected atomic.Bool

	lastMetricsUpdate time.Time
	lastDrawTime      time.Time
	droppedFrames     atomic.Uint64
	grpcMsgCount      atomic.Uint64
	hubUpdatedAt      time.Time
	impactUpdatedAt   time.Time
	streamUpdatedAt   time.Time
	prefixCounts      []PrefixCount

	VisualHubs map[string]*VisualHub
	ActiveHubs []*VisualHub

	prefixImpactHistory    []map[string]int
	prefixToClassification map[string]bgp.ClassificationType
	currentAnomalies       map[bgp.ClassificationType]map[string]int
	VisualImpact           map[string]*VisualImpact
	ActiveImpacts          []*VisualImpact
	ActiveASNImpacts       []*ASNImpact
	CriticalStream         []*CriticalEvent
	criticalQueue          []*CriticalEvent
	lastCriticalAddedAt    time.Time
	streamOffset           float64
	streamDirty            bool
	streamMu               sync.Mutex
	impactDirty            bool
	loadingHistorical      bool
	criticalCooldown       map[string]time.Time

	ctx       context.Context
	cancelCtx context.CancelFunc
	bgWg      sync.WaitGroup

	AudioDir         string
	VideoPath        string
	VideoWriter      io.WriteCloser
	VideoCmd         *exec.Cmd
	videoBuffer      []byte
	VideoStartDelay  time.Duration
	virtualTime      time.Time
	virtualStartTime time.Time
	MMDBFiles        []string

	HideUI                 bool
	MinimalUI              bool
	minimalUIKeyPressed    bool
	tourKeyPressed         bool
	tourSkipKeyPressed     bool
	tourOffset             time.Duration
	tourRegionStayDuration time.Duration

	// Viewport and Tour state
	currentZoom         float64
	currentCX           float64
	currentCY           float64
	targetZoom          float64
	targetCX            float64
	targetCY            float64
	tourManualStartTime time.Time
	tourRegionIndex     int // -1 means no tour active (full map)
	lastTourStateChange time.Time
	pipImage            *ebiten.Image

	lastPerfLog time.Time

	FrameCaptureInterval time.Duration
	FrameCaptureDir      string
	lastFrameCapturedAt  time.Time
	mapImage             *ebiten.Image

	// Reusable rendering resources
	face, monoFace, titleFace, titleMonoFace    *text.GoTextFace
	subFace, subMonoFace, extraFace, artistFace *text.GoTextFace
	titleFace09, titleFace05                    *text.GoTextFace
	drawOp                                      *ebiten.DrawImageOptions
	legendRows                                  []legendRow

	droppedPulses atomic.Uint64
	droppedQueue  atomic.Uint64
	droppedStale  atomic.Uint64

	eventCh chan *bgpEvent
	statsCh chan *statsEvent
}

func (e *Engine) Now() time.Time {
	if e.VideoWriter != nil {
		if e.virtualTime.IsZero() {
			e.virtualTime = time.Now()
		}
		return e.virtualTime
	}
	return time.Now()
}

func NewEngine(width, height int, scale float64) *Engine {
	s, err := text.NewGoTextFaceSource(bytes.NewReader(fontInter))
	if err != nil {
		log.Printf("Fatal: failed to load Inter font: %v", err)
	}
	m, err := text.NewGoTextFaceSource(bytes.NewReader(fontMono))
	if err != nil {
		log.Printf("Fatal: failed to load Mono font: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	e := &Engine{
		ctx:        ctx,
		cancelCtx:  cancel,
		Width:      width,
		Height:     height,
		FPS:        30,
		Scale:      scale,
		geo:        geoservice.NewGeoService(width, height, scale),
		cityBuffer: make(map[uint64]*BufferedCity),
		cityBufferPool: sync.Pool{
			New: func() interface{} {
				return &BufferedCity{}
			},
		},
		nextPulseEmittedAt:     time.Now(),
		fontSource:             s,
		monoSource:             m,
		countryActivity:        make(map[string]int),
		history:                make([]MetricSnapshot, 120),
		hubChangedAt:           make(map[string]time.Time),
		lastHubs:               make(map[string]int),
		hubPosition:            make(map[string]int),
		lastMetricsUpdate:      time.Now(),
		VisualHubs:             make(map[string]*VisualHub),
		prefixImpactHistory:    make([]map[string]int, 60), // 60 buckets * 20s = 20 mins
		prefixToClassification: make(map[string]bgp.ClassificationType),
		currentAnomalies:       make(map[bgp.ClassificationType]map[string]int),
		VisualImpact:           make(map[string]*VisualImpact),
		lastFrameCapturedAt:    time.Now(),
		drawOp:                 &ebiten.DrawImageOptions{},
		currentZoom:            1.0,
		targetZoom:             1.0,
		currentCX:              float64(width) / 2,
		currentCY:              float64(height) / 2,
		targetCX:               float64(width) / 2,
		targetCY:               float64(height) / 2,
		tourRegionIndex:        -1, // Start with full map
		tourRegionStayDuration: 10 * time.Second,
		eventCh:                make(chan *bgpEvent, 250000),
		statsCh:                make(chan *statsEvent, 250000),
		criticalCooldown:       make(map[string]time.Time),
		streamDirty:            true,
	}
	go e.runEventWorker()

	e.whitePixel = ebiten.NewImage(1, 1)
	e.whitePixel.Fill(color.White)

	e.fadeMask = ebiten.NewImage(256, 1)
	pix := make([]byte, 256*4)
	for i := 0; i < 256; i++ {
		pix[i*4] = 255
		pix[i*4+1] = 255
		pix[i*4+2] = 255
		pix[i*4+3] = uint8(i)
	}
	e.fadeMask.WritePixels(pix)

	fontSize := 18.0
	if width > 2000 {
		fontSize = 36.0
	}
	e.face = &text.GoTextFace{Source: s, Size: fontSize}
	e.monoFace = &text.GoTextFace{Source: m, Size: fontSize}
	e.titleFace = &text.GoTextFace{Source: s, Size: fontSize * 0.8}
	e.titleMonoFace = &text.GoTextFace{Source: m, Size: fontSize * 0.8}
	e.subFace = &text.GoTextFace{Source: s, Size: fontSize * 0.8}
	e.subMonoFace = &text.GoTextFace{Source: m, Size: fontSize * 0.8}
	e.extraFace = &text.GoTextFace{Source: s, Size: fontSize * 0.8}
	e.artistFace = &text.GoTextFace{Source: s, Size: fontSize * 0.7}
	e.titleFace09 = &text.GoTextFace{Source: s, Size: fontSize * 0.9}
	e.titleFace05 = &text.GoTextFace{Source: s, Size: fontSize * 0.5}

	e.legendRows = []legendRow{
		// Column 1: Normal (Blue/Purple)
		{"DISCOVERY", 0, ColorDiscovery, ColorGossipUI, func(s MetricSnapshot) float64 { return s.Global }},
		{"DDOS MITIGATION", 0, ColorDDoSMitigation, ColorDDoSMitigationUI, func(s MetricSnapshot) float64 { return s.DDoS }},
		{"PATH HUNTING", 0, ColorPolicy, ColorUpdUI, func(s MetricSnapshot) float64 { return s.Hunting }},

		// Column 2: Bad (Orange)
		{"FLAP", 0, ColorBad, ColorBad, func(s MetricSnapshot) float64 { return s.Flap }},

		// Column 3: Critical (Red)
		{"ROUTE LEAK", 0, ColorLeak, ColorWithUI, func(s MetricSnapshot) float64 { return s.Leak }},
		{"OUTAGE", 0, ColorOutage, ColorWithUI, func(s MetricSnapshot) float64 { return s.Outage }},
		{"BGP HIJACK", 0, ColorCritical, ColorWithUI, func(s MetricSnapshot) float64 { return s.Hijack }},
		{"BOGON / MARTIAN", 0, ColorCritical, ColorWithUI, func(s MetricSnapshot) float64 { return s.Bogon }},
	}

	e.InitPulseTexture()
	e.InitFlareTexture()
	e.InitSquareTexture()

	return e
}

func (e *Engine) InitGeoOnly(readOnly bool) error {
	// Initialize GeoService if not already done
	if e.geo == nil {
		e.geo = geoservice.NewGeoService(e.Width, e.Height, e.Scale)
	}
	return nil
}

func (e *Engine) GetIPCoords(ip uint32) (lat, lng float64, countryCode, city string) {
	return 0, 0, "", ""
}

func (e *Engine) LoadRemainingData() error {
	// 1. Open databases and load city data
	if err := e.InitGeoOnly(true); err != nil {
		return err
	}

	// 2. Start gRPC worker
	e.StartGRPCWorker("127.0.0.1:50051")

	// 3. Start pulse buffer loop
	go e.StartBufferLoop()

	log.Println("Engine startup complete. Listening for gRPC events...")

	return nil
}

func (e *Engine) GetGeoService() *geoservice.GeoService {
	return e.geo
}

func (e *Engine) drawGrid(img *image.RGBA) {
	// Draw subtle latitude/longitude grid (Cyber-grid)
	gridColor := color.RGBA{30, 35, 45, 255}
	// Longitude lines
	for lng := -180.0; lng <= 180.0; lng += 15.0 {
		var points [][]float64
		for lat := -90.0; lat <= 90.0; lat += 2.0 {
			points = append(points, []float64{lng, lat})
		}
		e.drawRingFast(img, points, gridColor)
	}
	// Latitude lines
	for lat := -90.0; lat <= 90.0; lat += 15.0 {
		var points [][]float64
		for lng := -180.0; lng <= 180.0; lng += 2.0 {
			points = append(points, []float64{lng, lat})
		}
		e.drawRingFast(img, points, gridColor)
	}
}

func (e *Engine) generateBackground() error {
	cacheDir := "./data/cache"
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		log.Printf("Warning: Failed to create cache directory: %v", err)
	}
	cacheFile := fmt.Sprintf("%s/bg_%dx%d_s%.1f.png", cacheDir, e.Width, e.Height, e.Scale)

	if img, err := e.loadCachedBackground(cacheFile); err == nil {
		e.bgImage = img
		return nil
	}

	log.Println("Generating background map...")
	start := time.Now()
	cpuImg := image.NewRGBA(image.Rect(0, 0, e.Width, e.Height))
	draw.Draw(cpuImg, cpuImg.Bounds(), &image.Uniform{color.RGBA{8, 10, 15, 255}}, image.Point{}, draw.Src)

	e.drawGrid(cpuImg)

	if err := e.drawFeatures(cpuImg); err != nil {
		return err
	}

	e.bgImage = ebiten.NewImageFromImage(cpuImg)
	log.Printf("Background map generated in %v", time.Since(start))

	go e.cacheBackground(cacheFile, cpuImg)

	return nil
}

func (e *Engine) loadCachedBackground(cacheFile string) (*ebiten.Image, error) {
	if _, err := os.Stat(cacheFile); err != nil {
		return nil, err
	}
	log.Printf("Loading cached background map from %s...", cacheFile)
	f, err := os.Open(cacheFile)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := f.Close(); err != nil {
			log.Printf("Error closing cache file: %v", err)
		}
	}()
	img, err := png.Decode(f)
	if err != nil {
		return nil, err
	}
	log.Println("Cached background map loaded successfully")
	return ebiten.NewImageFromImage(img), nil
}

func (e *Engine) drawFeatures(cpuImg *image.RGBA) error {
	fc, err := geojson.UnmarshalFeatureCollection(worldGeoJSON)
	if err != nil {
		return err
	}
	landColor, outlineColor := color.RGBA{26, 29, 35, 255}, color.RGBA{36, 42, 53, 255}
	for _, f := range fc.Features {
		if f.Geometry.IsPolygon() {
			e.fillPolygon(cpuImg, f.Geometry.Polygon, landColor)
			for _, ring := range f.Geometry.Polygon {
				e.drawRingFast(cpuImg, ring, outlineColor)
			}
		} else if f.Geometry.IsMultiPolygon() {
			for _, poly := range f.Geometry.MultiPolygon {
				e.fillPolygon(cpuImg, poly, landColor)
				for _, ring := range poly {
					e.drawRingFast(cpuImg, ring, outlineColor)
				}
			}
		}
	}
	return nil
}

func (e *Engine) cacheBackground(cacheFile string, cpuImg *image.RGBA) {
	f, err := os.Create(cacheFile)
	if err != nil {
		log.Printf("Warning: Failed to create background cache file: %v", err)
		return
	}
	defer func() {
		if err := f.Close(); err != nil {
			log.Printf("Error closing background cache file: %v", err)
		}
	}()
	if err := png.Encode(f, cpuImg); err != nil {
		log.Printf("Warning: Failed to encode background cache: %v", err)
	} else {
		log.Printf("Background map cached to %s", cacheFile)
	}
}

func (e *Engine) GenerateInitialBackground() error {
	if err := os.MkdirAll("data", 0o755); err != nil {
		log.Printf("Warning: Failed to create data directory: %v", err)
	}

	if err := e.generateBackground(); err != nil {
		return fmt.Errorf("failed to generate background: %w", err)
	}
	return nil
}

type point struct{ x, y float64 }

func (e *Engine) projectRings(rings [][][]float64) (projectedRings [][]point, minY, maxY float64) {
	projectedRings = make([][]point, len(rings))
	minY, maxY = float64(e.Height), 0.0
	for i, ring := range rings {
		projectedRings[i] = make([]point, 0, len(ring))
		for _, p := range ring {
			x, y := e.geo.Project(p[1], p[0])
			if math.IsNaN(x) || math.IsNaN(y) {
				continue
			}
			projectedRings[i] = append(projectedRings[i], point{x, y})
			if y < minY {
				minY = y
			}
			if y > maxY {
				maxY = y
			}
		}
	}
	return projectedRings, minY, maxY
}

func (e *Engine) scanlineFill(img *image.RGBA, projectedRings [][]point, minY, maxY float64, c color.RGBA) {
	for y := int(minY); y <= int(maxY); y++ {
		if y < 0 || y >= e.Height {
			continue
		}
		var nodes []int
		fy := float64(y)
		for _, ring := range projectedRings {
			for i := 0; i < len(ring); i++ {
				j := (i + 1) % len(ring)
				if (ring[i].y < fy && ring[j].y >= fy) || (ring[j].y < fy && ring[i].y >= fy) {
					nodeX := ring[i].x + (fy-ring[i].y)/(ring[j].y-ring[i].y)*(ring[j].x-ring[i].x)
					nodes = append(nodes, int(nodeX))
				}
			}
		}
		sort.Ints(nodes)
		for i := 0; i < len(nodes)-1; i += 2 {
			xs, xe := nodes[i], nodes[i+1]
			if xs < 0 {
				xs = 0
			}
			if xe >= e.Width {
				xe = e.Width - 1
			}
			for x := xs; x < xe; x++ {
				off := y*img.Stride + x*4
				img.Pix[off], img.Pix[off+1], img.Pix[off+2], img.Pix[off+3] = c.R, c.G, c.B, 255
			}
		}
	}
}

func (e *Engine) fillPolygon(img *image.RGBA, rings [][][]float64, c color.RGBA) {
	if len(rings) == 0 {
		return
	}
	projectedRings, minY, maxY := e.projectRings(rings)
	e.scanlineFill(img, projectedRings, minY, maxY, c)
}

func (e *Engine) drawRingFast(img *image.RGBA, coords [][]float64, c color.RGBA) {
	for i := 0; i < len(coords)-1; i++ {
		x1, y1 := e.geo.Project(coords[i][1], coords[i][0])
		x2, y2 := e.geo.Project(coords[i+1][1], coords[i+1][0])
		if math.IsNaN(x1) || math.IsNaN(y1) || math.IsNaN(x2) || math.IsNaN(y2) {
			continue
		}
		e.drawLineFast(img, int(x1), int(y1), int(x2), int(y2), c)
	}
}

func (e *Engine) drawLineFast(img *image.RGBA, x1, y1, x2, y2 int, c color.RGBA) {
	dx, dy := math.Abs(float64(x2-x1)), math.Abs(float64(y2-y1))
	sx, sy := -1, -1
	if x1 < x2 {
		sx = 1
	}
	if y1 < y2 {
		sy = 1
	}
	err := dx - dy
	for {
		if x1 >= 0 && x1 < e.Width && y1 >= 0 && y1 < e.Height {
			off := y1*img.Stride + x1*4
			img.Pix[off], img.Pix[off+1], img.Pix[off+2], img.Pix[off+3] = c.R, c.G, c.B, 255
		}
		if x1 == x2 && y1 == y2 {
			break
		}
		e2 := 2 * err
		if e2 > -dy {
			err -= dy
			x1 += sx
		}
		if e2 < dx {
			err += dx
			y1 += sy
		}
	}
}

func (e *Engine) AddPulse(lat, lng float64, c color.RGBA, count int, shape ...EventShape) {
	s := ShapeCircle
	if len(shape) > 0 {
		s = shape[0]
	} else if c == ColorLeak {
		s = ShapeFlare
	}

	// De-emphasize Discovery pulses slightly
	if c == ColorDiscovery {
		c.A = 160
	}

	lat += (rand.Float64() - 0.5) * 1.5
	lng += (rand.Float64() - 0.5) * 1.5
	x, y := e.geo.Project(lat, lng)
	e.pulsesMu.Lock()
	defer e.pulsesMu.Unlock()
	if len(e.pulses) < MaxActivePulses {
		baseRad := 6.0
		if e.Width > 2000 {
			baseRad = 12.0
		}

		if c == ColorDiscovery {
			baseRad *= 0.7
		}

		// Use natural log (ln) for slower growth at high counts
		growth := baseRad * 1.2
		radius := baseRad + math.Log(float64(count))*growth

		if radius > 240 {
			radius = 240
		}

		// Randomize duration to prevent synchronized expiration and 'emptying out'
		duration := 1200*time.Millisecond + time.Duration(rand.Intn(800))*time.Millisecond

		e.pulses = append(e.pulses, Pulse{
			X: x, Y: y,
			StartTime: e.Now(),
			Duration:  duration,
			Color:     c,
			MaxRadius: radius,
			Shape:     s,
		})
	} else {
		e.droppedPulses.Add(1)
	}
}

func (e *Engine) UpdatePerformanceMetrics() {
	now := e.Now()
	elapsed := now.Sub(e.lastPerfLog)
	if elapsed < 5*time.Second {
		return
	}
	e.lastPerfLog = now

	tps := ebiten.ActualTPS()
	fps := ebiten.ActualFPS()
	droppedPulses := e.droppedPulses.Swap(0)
	droppedQueue := e.droppedQueue.Swap(0)
	droppedStale := e.droppedStale.Swap(0)
	droppedFrames := e.droppedFrames.Swap(0)
	grpcMsgCount := e.grpcMsgCount.Swap(0)
	grpcRate := float64(grpcMsgCount) / elapsed.Seconds()

	var sb strings.Builder
	sb.WriteString("[PERF]")
	fmt.Fprintf(&sb, " TPS: %.2f, FPS: %.2f, gRPC Events: %.2f/s", tps, fps, grpcRate)
	if droppedFrames > 0 {
		fmt.Fprintf(&sb, ", DroppedFrames: %d", droppedFrames)
	}
	if droppedPulses > 0 {
		fmt.Fprintf(&sb, ", DroppedPulses: %d", droppedPulses)
	}
	if droppedQueue > 0 {
		fmt.Fprintf(&sb, ", DroppedQueue: %d", droppedQueue)
	}
	if droppedStale > 0 {
		fmt.Fprintf(&sb, ", DroppedStale: %d", droppedStale)
	}
	if tps < 28 || fps < 28 {
		sb.WriteString(" (Lag detected)")
	}
	log.Println(sb.String())
}

func (e *Engine) Update() error {
	if e.VideoWriter != nil {
		if e.virtualTime.IsZero() {
			e.virtualTime = time.Now()
			e.virtualStartTime = e.virtualTime
		} else {
			// Advance virtual clock by exactly 1/30s per frame
			e.virtualTime = e.virtualTime.Add(time.Second / 30)
		}
	}

	e.UpdateTour()
	e.UpdatePerformanceMetrics()
	e.updateVisualQueue()
	e.updateInput()
	e.updateMetrics()
	e.updateCriticalStream()
	e.updateActivePulses()
	return nil
}

func (e *Engine) updateVisualQueue() {
	now := e.Now()
	e.queueMu.Lock()
	defer e.queueMu.Unlock()

	added := 0
	maxAdded := DefaultPulsesPerTick
	if len(e.visualQueue) > VisualQueueThreshold {
		maxAdded = BurstPulsesPerTick
	}

	for len(e.visualQueue) > 0 && (e.visualQueue[0].ScheduledTime.Before(now) || len(e.visualQueue) > VisualQueueCull) && added < maxAdded {
		p := e.visualQueue[0]
		e.visualQueue = e.visualQueue[1:]
		added++
		// Allow up to 5 seconds of delay during massive spikes before dropping pulses
		if now.Sub(p.ScheduledTime) < 5*time.Second {
			e.AddPulse(p.Lat, p.Lng, p.Color, p.Count, p.Shape)
		} else {
			e.droppedStale.Add(1)
		}
	}
}

func (e *Engine) updateInput() {
	if ebiten.IsKeyPressed(ebiten.KeyM) {
		if !e.minimalUIKeyPressed {
			e.MinimalUI = !e.MinimalUI
			e.minimalUIKeyPressed = true
		}
	} else {
		e.minimalUIKeyPressed = false
	}

	if ebiten.IsKeyPressed(ebiten.KeyT) {
		if !e.tourKeyPressed {
			e.tourManualStartTime = e.Now()
			e.tourOffset = 0 // Reset offset on manual start
			e.tourKeyPressed = true
		}
	} else {
		e.tourKeyPressed = false
	}

	if ebiten.IsKeyPressed(ebiten.KeyN) {
		if !e.tourSkipKeyPressed {
			e.handleTourSkip()
			e.tourSkipKeyPressed = true
		}
	} else {
		e.tourSkipKeyPressed = false
	}
}

func (e *Engine) handleTourSkip() {
	// Calculate current elapsed time to figure out the next jump
	now := e.Now()
	tourDuration := time.Duration(len(regions)) * e.tourRegionStayDuration
	cycleDuration := 10 * time.Minute
	elapsedInCycle := now.Sub(now.Truncate(cycleDuration))
	elapsedSinceManual := now.Sub(e.tourManualStartTime)

	var elapsed time.Duration
	if !e.tourManualStartTime.IsZero() && elapsedSinceManual < tourDuration+10*time.Second {
		elapsed = elapsedSinceManual + e.tourOffset
	} else {
		elapsed = elapsedInCycle + e.tourOffset
	}

	// Snap to the beginning of the next 10-second bucket
	currentIdx := int(elapsed.Seconds() / e.tourRegionStayDuration.Seconds())
	targetElapsed := time.Duration(currentIdx+1) * e.tourRegionStayDuration
	e.tourOffset += (targetElapsed - elapsed)
}

func (e *Engine) updateMetrics() {
	e.metricsMu.Lock()
	defer e.metricsMu.Unlock()

	for cc, vh := range e.VisualHubs {
		vh.DisplayY = vh.TargetY
		vh.Alpha += (vh.TargetAlpha - vh.Alpha) * 0.2
		if !vh.Active || vh.Alpha < 0.01 {
			delete(e.VisualHubs, cc)
		}
	}

	// Cleanup Critical Event Stream (remove entries older than 10 mins)
	now := e.Now()
	e.streamMu.Lock()
	activeStream := e.CriticalStream[:0]
	removedAny := false
	for _, ce := range e.CriticalStream {
		if now.Sub(ce.Timestamp) < 10*time.Minute {
			activeStream = append(activeStream, ce)
		} else {
			removedAny = true
		}
	}
	if removedAny {
		e.CriticalStream = activeStream
		e.streamDirty = true
	}
	e.streamMu.Unlock()
}

func (e *Engine) updateActivePulses() {
	now := e.Now()
	e.pulsesMu.Lock()
	defer e.pulsesMu.Unlock()

	active := e.pulses[:0]
	for _, p := range e.pulses {
		if now.Sub(p.StartTime) < p.Duration {
			active = append(active, p)
		}
	}
	e.pulses = active
}

func (e *Engine) Draw(screen *ebiten.Image) {
	now := e.Now()
	if !e.lastDrawTime.IsZero() {
		if now.Sub(e.lastDrawTime) > 50*time.Millisecond {
			e.droppedFrames.Add(1)
		}
	}
	e.lastDrawTime = now

	if e.mapImage == nil || e.mapImage.Bounds().Dx() != e.Width || e.mapImage.Bounds().Dy() != e.Height {
		e.mapImage = ebiten.NewImage(e.Width, e.Height)
	}

	if e.bgImage != nil {
		e.mapImage.DrawImage(e.bgImage, nil)
	} else {
		e.mapImage.Fill(color.RGBA{8, 10, 15, 255})
	}

	e.pulsesMu.Lock()
	now = e.Now()
	e.drawOp.GeoM.Reset()
	e.drawOp.ColorScale.Reset()
	e.drawOp.Filter = ebiten.FilterLinear // Use linear for smooth scaling
	e.drawOp.Blend = ebiten.BlendLighter

	// Batch pulses by image to reduce draw calls
	for _, p := range e.pulses {
		elapsed := now.Sub(p.StartTime).Seconds()
		totalDuration := p.Duration.Seconds()
		progress := elapsed / totalDuration
		if progress > 1.0 {
			continue
		}

		baseAlpha := 0.5
		alpha := (1.0 - progress) * baseAlpha
		maxRadiusMultiplier := 1.0

		imgW := float64(e.pulseImage.Bounds().Dx())
		imgToDraw := e.pulseImage

		switch p.Shape {
		case ShapeFlare:
			imgW = float64(e.flareImage.Bounds().Dx())
			imgToDraw = e.flareImage
			maxRadiusMultiplier = 3.0
			flareIntensity := math.Sin(progress * math.Pi)
			flareIntensity = math.Pow(flareIntensity, 1.5) * 2.5
			alpha = flareIntensity
		case ShapeSquare:
			imgW = float64(e.squareImage.Bounds().Dx())
			imgToDraw = e.squareImage
			// A square pulse can have similar radius expansion
		}

		scale := (1 + progress*p.MaxRadius*maxRadiusMultiplier) / imgW * 2.0
		halfW := imgW / 2

		e.drawOp.GeoM.Reset()
		e.drawOp.GeoM.Translate(-halfW, -halfW)
		e.drawOp.GeoM.Scale(scale, scale)
		e.drawOp.GeoM.Translate(p.X, p.Y)

		r, g, b := float32(p.Color.R)/255.0, float32(p.Color.G)/255.0, float32(p.Color.B)/255.0
		e.drawOp.ColorScale.Reset()
		e.drawOp.ColorScale.Scale(r*float32(alpha), g*float32(alpha), b*float32(alpha), float32(alpha))
		e.mapImage.DrawImage(imgToDraw, e.drawOp)
	}
	e.pulsesMu.Unlock()

	shouldCapture := e.FrameCaptureInterval > 0 && now.Sub(e.lastFrameCapturedAt) >= e.FrameCaptureInterval
	if shouldCapture {
		e.lastFrameCapturedAt = now
		e.captureFrame(e.mapImage, "map", now)
	}

	e.drawOp.GeoM.Reset()
	e.drawOp.ColorScale.Reset()
	e.ApplyTourTransform(e.drawOp)
	screen.DrawImage(e.mapImage, e.drawOp)

	if !e.HideUI {
		e.DrawPIP(screen)
		e.DrawBGPStatus(screen)
	}

	if shouldCapture {
		e.captureFrame(screen, "full", now)
	}

	if e.VideoWriter != nil {
		if e.virtualStartTime.IsZero() || e.Now().Sub(e.virtualStartTime) >= e.VideoStartDelay {
			e.captureVideoFrame(screen)
		}
	}
}

func (e *Engine) Layout(w, h int) (width, height int) { return e.Width, e.Height }

func (e *Engine) runEventWorker() {
	batch := make([]*bgpEvent, 0, 1000)
	ticker := time.NewTicker(10 * time.Millisecond)
	for {
		select {
		case ev, ok := <-e.eventCh:
			if !ok {
				return
			}
			batch = append(batch, ev)
			if len(batch) >= 1000 {
				e.processEventBatch(batch)
				batch = batch[:0]
			}
		case <-ticker.C:
			if len(batch) > 0 {
				e.processEventBatch(batch)
				batch = batch[:0]
			}
		}
	}
}

func (e *Engine) processEventBatch(batch []*bgpEvent) {
	type batchKey struct {
		lat, lng float64
		c        color.RGBA
		shape    EventShape
	}
	localBatch := make(map[batchKey]int)

	for _, ev := range batch {
		c, _, shape := e.getClassificationVisuals(ev.classificationType)
		if c == (color.RGBA{}) || (ev.lat == 0 && ev.lng == 0) {
			continue
		}
		// Round to 2 decimal places to aggregate pulses that are very close (~1.1km)
		lat := math.Round(ev.lat*100) / 100
		lng := math.Round(ev.lng*100) / 100
		localBatch[batchKey{lat, lng, c, shape}]++
	}

	e.bufferMu.Lock()
	defer e.bufferMu.Unlock()
	for k, count := range localBatch {
		hashKey := math.Float64bits(k.lat) ^ (math.Float64bits(k.lng) << 1)
		b, ok := e.cityBuffer[hashKey]
		if !ok {
			b = e.cityBufferPool.Get().(*BufferedCity)
			b.Lat = k.lat
			b.Lng = k.lng
			e.cityBuffer[hashKey] = b
		}
		if b.Counts == nil {
			b.Counts = make(map[PulseKey]int)
		}
		b.Counts[PulseKey{Color: k.c, Shape: k.shape}] += count
	}
}

func (e *Engine) recordEvent(lat, lng float64, cc, city string, eventType bgp.EventType, classificationType bgp.ClassificationType, prefix string, asn, historicalASN uint32, leakDetail *bgp.LeakDetail, anomalyDetails *bgp.AnomalyDetails) {
	select {
	case e.eventCh <- &bgpEvent{lat, lng, cc, city, eventType, classificationType, prefix, asn, historicalASN, leakDetail, anomalyDetails}:
	default:
		// Drop event if engine is too busy
	}
}

func (e *Engine) RecordStateTransition(trans *livemap.StateTransition) {
	e.streamMu.Lock()
	defer e.streamMu.Unlock()

	ct := bgp.ClassificationType(trans.NewState)
	oldCt := bgp.ClassificationType(trans.OldState)
	anomName := ct.String()

	// 1. Clean up old state if this prefix was in a different category before
	// If it transitioned to None/Discovery, this will remove it completely since anomName won't match oldCt
	if oldCt != bgp.ClassificationNone && oldCt != bgp.ClassificationDiscovery && oldCt != ct {
		e.removePrefixFromOldEventsLocked(trans.Prefix, anomName)

		if e.loadingHistorical {
			// During catch-up, don't keep resolved events at all
			e.cullResolvedEvents()
		}
	}

	// 2. We only care about tracking and displaying these specific critical events
	if ct != bgp.ClassificationOutage && ct != bgp.ClassificationRouteLeak && ct != bgp.ClassificationMinorRouteLeak && ct != bgp.ClassificationHijack {
		e.streamDirty = true
		return
	}

	// 3. Identify anomaly color
	uiCol := e.getClassificationUIColor(anomName)
	realCol, _, _ := e.getClassificationVisuals(ct)

	// 4. Try to update existing event in the stream
	updated := false
	for _, ce := range e.CriticalStream {
		if ce.Anom == anomName && ce.ASN == trans.Asn {
			e.updateCriticalEventFromTransition(ce, trans)
			updated = true
			break
		}
	}

	if !updated {
		for _, ce := range e.criticalQueue {
			if ce.Anom == anomName && ce.ASN == trans.Asn {
				e.updateCriticalEventFromTransition(ce, trans)
				updated = true
				break
			}
		}
	}

	// 5. Create new event if not found
	// Only add if it's a new active (unresolved) event
	if !updated && trans.EndTime == 0 {
		newCE := e.createCriticalEventFromTransition(trans, realCol, uiCol, anomName)
		e.criticalQueue = append(e.criticalQueue, newCE)
		e.lastCriticalAddedAt = time.Now()
	}

	e.streamDirty = true
}

func (e *Engine) removePrefixFromOldEventsLocked(prefix, currentAnomName string) {
	if prefix == "" {
		return
	}
	e.removeFromCriticalSlice(&e.CriticalStream, prefix, currentAnomName)
	e.removeFromCriticalSlice(&e.criticalQueue, prefix, currentAnomName)
}

func (e *Engine) updateCriticalEventFromTransition(ce *CriticalEvent, trans *livemap.StateTransition) {
	if ce.ImpactedPrefixes == nil {
		ce.ImpactedPrefixes = make(map[string]struct{})
	}
	if ce.ActivePrefixes == nil {
		ce.ActivePrefixes = make(map[string]struct{})
	}
	if ce.ActiveIncidentIDs == nil {
		ce.ActiveIncidentIDs = make(map[string]struct{})
	}
	if trans.Prefix != "" {
		if _, ok := ce.ImpactedPrefixes[trans.Prefix]; !ok {
			ce.ImpactedPrefixes[trans.Prefix] = struct{}{}
			ce.ImpactedIPs += utils.GetPrefixSize(trans.Prefix)
		}
		if trans.EndTime == 0 {
			ce.ActivePrefixes[trans.Prefix] = struct{}{}
		} else {
			delete(ce.ActivePrefixes, trans.Prefix)
		}
	}
	if trans.IncidentId != "" {
		ce.ActiveIncidentIDs[trans.IncidentId] = struct{}{}
	}

	if trans.AsName != "" {
		ce.OrgID = trans.AsName
	}

	if trans.LeakDetail != nil {
		if trans.LeakDetail.LeakerAsn > 0 {
			ce.LeakerASN = trans.LeakDetail.LeakerAsn
		}
		if trans.LeakDetail.LeakerAsName != "" {
			ce.LeakerName = trans.LeakDetail.LeakerAsName
		}
		ce.LeakerRPKI = int32(trans.LeakDetail.LeakerRpkiStatus)

		if trans.LeakDetail.VictimAsn > 0 {
			ce.VictimASN = trans.LeakDetail.VictimAsn
		}
		if trans.LeakDetail.VictimAsName != "" {
			ce.VictimName = trans.LeakDetail.VictimAsName
		}
		ce.VictimRPKI = int32(trans.LeakDetail.VictimRpkiStatus)

		switch trans.LeakDetail.LeakType {
		case 1:
			ce.LeakType = bgp.LeakReOrigination
		case 2:
			ce.LeakType = bgp.LeakHairpin
		case 3:
			ce.LeakType = bgp.LeakLateral
		case 4:
			ce.LeakType = bgp.DDoSFlowspec
		case 5:
			ce.LeakType = bgp.DDoSRTBH
		case 6:
			ce.LeakType = bgp.DDoSTrafficRedirection
		case 7:
			ce.LeakType = bgp.LeakValleyFree
		default:
			ce.LeakType = bgp.LeakUnknown
		}
	}

	ce.Resolved = len(ce.ActivePrefixes) == 0

	loc := ""
	if trans.City != "" && trans.Country != "" {
		loc = trans.City + ", " + trans.Country
	} else if trans.City != "" {
		loc = trans.City
	} else if trans.Country != "" {
		loc = trans.Country
	}

	if loc != "" {
		if ce.Locations == "" {
			ce.Locations = loc
		} else if !strings.Contains(ce.Locations, loc) {
			ce.Locations += " | " + loc
		}
	}
	e.updateCriticalEventCacheStrs(ce)
}

func (e *Engine) cullResolvedEvents() {
	filter := func(slice []*CriticalEvent) []*CriticalEvent {
		result := make([]*CriticalEvent, 0, len(slice))
		for _, ce := range slice {
			if !ce.Resolved {
				result = append(result, ce)
			}
		}
		return result
	}
	e.CriticalStream = filter(e.CriticalStream)
	e.criticalQueue = filter(e.criticalQueue)
}

func (e *Engine) createCriticalEventFromTransition(trans *livemap.StateTransition, c, uiCol color.RGBA, name string) *CriticalEvent {
	ce := &CriticalEvent{
		Timestamp:         time.Unix(trans.StartTime, 0),
		Anom:              name,
		ASN:               trans.Asn,
		ASNStr:            fmt.Sprintf("AS%d", trans.Asn),
		OrgID:             trans.AsName,
		Locations:         func() string { if trans.Country != "" && trans.City != "" { return trans.City + ", " + trans.Country }; if trans.City != "" { return trans.City }; return trans.Country }(),
		Color:             c,
		UIColor:           uiCol,
		ImpactedPrefixes:  make(map[string]struct{}),
		ActivePrefixes:    make(map[string]struct{}),
		ActiveIncidentIDs: make(map[string]struct{}),
		VictimASN:         trans.Asn,
		VictimName:        trans.AsName,
	}
	ce.ImpactedPrefixes[trans.Prefix] = struct{}{}
	if trans.EndTime == 0 {
		ce.ActivePrefixes[trans.Prefix] = struct{}{}
	}
	ce.ImpactedIPs = utils.GetPrefixSize(trans.Prefix)
	if trans.IncidentId != "" {
		ce.ActiveIncidentIDs[trans.IncidentId] = struct{}{}
	}

	if trans.LeakDetail != nil {
		ce.LeakerASN = trans.LeakDetail.LeakerAsn
		ce.LeakerName = trans.LeakDetail.LeakerAsName
		ce.LeakerRPKI = int32(trans.LeakDetail.LeakerRpkiStatus)
		ce.VictimASN = trans.LeakDetail.VictimAsn
		ce.VictimName = trans.LeakDetail.VictimAsName
		ce.VictimRPKI = int32(trans.LeakDetail.VictimRpkiStatus)

		// Map from Rust's LeakType enum to Go's bgp.LeakType
		switch trans.LeakDetail.LeakType {
		case 1:
			ce.LeakType = bgp.LeakReOrigination
		case 2:
			ce.LeakType = bgp.LeakHairpin
		case 3:
			ce.LeakType = bgp.LeakLateral
		case 4:
			ce.LeakType = bgp.DDoSFlowspec
		case 5:
			ce.LeakType = bgp.DDoSRTBH
		case 6:
			ce.LeakType = bgp.DDoSTrafficRedirection
		case 7:
			ce.LeakType = bgp.LeakValleyFree
		default:
			ce.LeakType = bgp.LeakUnknown
		}
	}

	e.updateCriticalEventCacheStrs(ce)
	return ce
}

func (e *Engine) recordToCriticalStream(ev *bgpEvent, c color.RGBA, name string) {
	// Legacy for non-gRPC
}

func (e *Engine) removePrefixFromOldEvents(prefix, currentAnomName string) {
	e.streamMu.Lock()
	defer e.streamMu.Unlock()
	e.removePrefixFromOldEventsLocked(prefix, currentAnomName)
}

func (e *Engine) removeFromCriticalSlice(slice *[]*CriticalEvent, prefix, currentAnomName string) bool {
	for i := 0; i < len(*slice); i++ {
		ce := (*slice)[i]
		if ce.ActivePrefixes != nil {
			if _, ok := ce.ActivePrefixes[prefix]; ok {
				if currentAnomName != ce.Anom {
					e.removePrefixFromEvent(ce, prefix)
				}
				return true
			}
		}
	}
	return false
}

func (e *Engine) removePrefixFromEvent(ce *CriticalEvent, prefix string) {
	delete(ce.ActivePrefixes, prefix)
	ce.Resolved = len(ce.ActivePrefixes) == 0
	e.updateCriticalEventCacheStrs(ce)
}

func (e *Engine) isSameEvent(ce *CriticalEvent, ev *bgpEvent, name string) bool {
	return false
}

func (e *Engine) updateExistingCriticalEvent(ce *CriticalEvent, ev *bgpEvent) bool {
	return false
}

func (e *Engine) createCriticalEvent(ev *bgpEvent, c color.RGBA, name, asnStr, orgID, newLoc string, now time.Time) *CriticalEvent {
	return &CriticalEvent{}
}

func (e *Engine) isEventSignificant(ce *CriticalEvent) bool {
	// Only consider these major anomalies for the major event stream
	if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
		return false
	}
	if ce.ImpactedIPs >= 5000 {
		return true
	}
	v6Count := 0
	for p := range ce.ImpactedPrefixes {
		if strings.Contains(p, ":") {
			v6Count++
			if v6Count >= 20 {
				return true
			}
		}
	}
	return false
}

func (e *Engine) updateCriticalStream() {
	e.streamMu.Lock()
	defer e.streamMu.Unlock()

	// 1. Animate offset towards 0
	if math.Abs(e.streamOffset) > 0.1 {
		e.streamOffset *= 0.85
		e.streamDirty = true
	} else if e.streamOffset != 0 {
		e.streamOffset = 0
		e.streamDirty = true
	}

	// Clean up resolved events from queue first
	activeQueue := e.criticalQueue[:0]
	for _, ce := range e.criticalQueue {
		if !ce.Resolved {
			activeQueue = append(activeQueue, ce)
		}
	}
	e.criticalQueue = activeQueue

	// 2. Promote from queue if enough time has passed
	if len(e.criticalQueue) > 0 && time.Since(e.lastCriticalAddedAt) > 100*time.Millisecond {
		var ev *CriticalEvent
		var evIdx int = -1

		for i, ce := range e.criticalQueue {
			if e.isEventSignificant(ce) {
				ev = ce
				evIdx = i
				break
			}
		}

		if ev != nil {
			// Remove from queue
			e.criticalQueue = append(e.criticalQueue[:evIdx], e.criticalQueue[evIdx+1:]...)

			// Insert at the front
			e.CriticalStream = append([]*CriticalEvent{ev}, e.CriticalStream...)
			if len(e.CriticalStream) > 5 {
				e.CriticalStream = e.CriticalStream[:5]
			}

			// Push the stream down visually
			e.streamOffset += 1.0
			e.streamDirty = true
			e.lastCriticalAddedAt = time.Now()
		}
	}
}

func (e *Engine) updateCriticalEventCacheStrs(ce *CriticalEvent) {
	if ce.CachedTypeLabel == "" {
		if (ce.Anom == bgp.NameRouteLeak || ce.Anom == bgp.NameMinorRouteLeak) && ce.LeakType != bgp.LeakUnknown {
			ce.CachedTypeLabel = fmt.Sprintf("[%s] [%s]", strings.ToUpper(ce.Anom), strings.ToUpper(ce.LeakType.String()))
		} else {
			ce.CachedTypeLabel = fmt.Sprintf("[%s]", strings.ToUpper(ce.Anom))
		}
	}
	if e.subMonoFace != nil {
		ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
	}

	if ce.IsAggregate {
		// Locations line
		if ce.CachedLocLabel == "" {
			ce.CachedLocLabel = " "
		}
		if ce.Locations != "" {
			locs := strings.Split(ce.Locations, " | ")
			if len(locs) <= 2 {
				ce.CachedLocVal = ce.Locations
			} else {
				displayLocs := locs[:2]
				ce.CachedLocVal = fmt.Sprintf("%s | %s (%d more)", displayLocs[0], displayLocs[1], len(locs)-2)
			}
		} else {
			ce.CachedLocVal = ""
		}
		return
	}

	switch ce.Anom {
	case bgp.NameRouteLeak, bgp.NameMinorRouteLeak:
		// ASN is redundant for Route Leaks as Leaker/Victim are already shown
		e.cacheLeakStrings(ce)
	case bgp.NameHardOutage:
		e.cacheOutageStrings(ce)
	case bgp.NameHijack, bgp.NameDDoSMitigation:
		e.cacheHijackDDoSStrings(ce)
	}

	e.cacheImpactStrings(ce)

	// Locations line
	if ce.CachedLocLabel == "" {
		ce.CachedLocLabel = " "
	}
	if ce.Locations != "" {
		locs := strings.Split(ce.Locations, " | ")
		if len(locs) <= 2 {
			ce.CachedLocVal = ce.Locations
		} else {
			displayLocs := locs[:2]
			ce.CachedLocVal = fmt.Sprintf("%s | %s (%d more)", displayLocs[0], displayLocs[1], len(locs)-2)
		}
	} else {
		ce.CachedLocVal = ""
	}
}

func (e *Engine) cacheHijackDDoSStrings(ce *CriticalEvent) {
	// Attacker/Source line
	if ce.Anom == bgp.NameHijack {
		ce.CachedLeakerLabel = " Attacker"
	} else {
		ce.CachedLeakerLabel = "   Source"
	}

	if ce.LeakerASN > 0 {
		if ce.LeakerName != "" {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d (%s)", ce.LeakerASN, ce.LeakerName)
		} else {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d", ce.LeakerASN)
		}
	} else {
		ce.CachedLeakerVal = "Unknown"
	}

	// Victim/Target line
	if ce.Anom == bgp.NameHijack {
		ce.CachedVictimLabel = "   Victim"
	} else {
		ce.CachedVictimLabel = "   Target"
	}

	if ce.VictimASN > 0 {
		if ce.VictimName != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.VictimName)
		} else if ce.OrgID != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.OrgID)
		} else {
			ce.CachedVictimVal = fmt.Sprintf("AS%d", ce.VictimASN)
		}
	} else {
		ce.CachedVictimVal = ce.ASNStr
	}

	// Networks line
	networks := make([]string, 0, len(ce.ImpactedPrefixes))
	for p := range ce.ImpactedPrefixes {
		networks = append(networks, p)
	}
	sort.Strings(networks)

	const maxShow = 2
	displayNets := networks
	moreCount := 0
	if len(networks) > maxShow {
		displayNets = networks[:maxShow]
		moreCount = len(networks) - maxShow
	}

	ce.CachedNetLabel = "  Networks: "
	netVal := strings.Join(displayNets, ", ")
	if moreCount > 0 {
		netVal += fmt.Sprintf(", (%d more)", moreCount)
	}
	ce.CachedNetVal = netVal
}

func formatRPKI(status int32) string {
	switch status {
	case 1:
		return "VALID"
	case 2:
		return "INVALID"
	default:
		return "UNKNOWN"
	}
}

func (e *Engine) cacheLeakStrings(ce *CriticalEvent) {
	// Leaker line
	ce.CachedLeakerLabel = "   Leaker"
	if ce.LeakerASN > 0 {
		if ce.LeakerName != "" {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d (%s)", ce.LeakerASN, ce.LeakerName)
		} else {
			ce.CachedLeakerVal = fmt.Sprintf("AS%d", ce.LeakerASN)
		}
	} else {
		ce.CachedLeakerVal = "Unknown"
	}

	// Impacted ASN line
	ce.CachedVictimLabel = " Impacted"
	if ce.VictimASN > 0 {
		if ce.VictimName != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.VictimName)
		} else if ce.OrgID != "" {
			ce.CachedVictimVal = fmt.Sprintf("AS%d (%s)", ce.VictimASN, ce.OrgID)
		} else {
			ce.CachedVictimVal = fmt.Sprintf("AS%d", ce.VictimASN)
		}
	} else {
		if ce.OrgID != "" {
			ce.CachedVictimVal = fmt.Sprintf("%s (%s)", ce.ASNStr, ce.OrgID)
		} else {
			ce.CachedVictimVal = ce.ASNStr
		}
	}

	// Networks line
	networks := make([]string, 0, len(ce.ImpactedPrefixes))
	for p := range ce.ImpactedPrefixes {
		networks = append(networks, p)
	}
	sort.Strings(networks)

	const maxShow = 2
	displayNets := networks
	moreCount := 0
	if len(networks) > maxShow {
		displayNets = networks[:maxShow]
		moreCount = len(networks) - maxShow
	}

	ce.CachedNetLabel = "  Networks: "
	netVal := strings.Join(displayNets, ", ")
	if moreCount > 0 {
		netVal += fmt.Sprintf(", (%d more)", moreCount)
	}
	ce.CachedNetVal = netVal
}

func (e *Engine) cacheOutageStrings(ce *CriticalEvent) {
	// ASN line
	ce.CachedASNLabel = ""
	if ce.OrgID != "" {
		ce.CachedASNVal = fmt.Sprintf("%s (%s)", ce.ASNStr, ce.OrgID)
	} else {
		ce.CachedASNVal = ce.ASNStr
	}

	// Networks line
	networks := make([]string, 0, len(ce.ImpactedPrefixes))
	for p := range ce.ImpactedPrefixes {
		networks = append(networks, p)
	}
	sort.Strings(networks)

	const maxShow = 2
	displayNets := networks
	moreCount := 0
	if len(networks) > maxShow {
		displayNets = networks[:maxShow]
		moreCount = len(networks) - maxShow
	}

	ce.CachedNetLabel = "  Networks: "
	netVal := strings.Join(displayNets, ", ")
	if moreCount > 0 {
		netVal += fmt.Sprintf(", (%d more)", moreCount)
	}
	ce.CachedNetVal = netVal

	// Calculate impact string for the label
	v6Count := 0
	for p := range ce.ImpactedPrefixes {
		if strings.Contains(p, ":") {
			v6Count++
		}
	}

	impactParts := []string{}
	if ce.ImpactedIPs > 0 {
		impactStr := ""
		switch {
		case ce.ImpactedIPs >= 1000000:
			impactStr = fmt.Sprintf("%.1fM", float64(ce.ImpactedIPs)/1000000.0)
		case ce.ImpactedIPs >= 1000:
			impactStr = fmt.Sprintf("%.1fK", float64(ce.ImpactedIPs)/1000.0)
		default:
			impactStr = fmt.Sprintf("%d", ce.ImpactedIPs)
		}
		impactParts = append(impactParts, fmt.Sprintf("%s IPv4 Addrs", impactStr))
	}
	if v6Count > 0 {
		impactParts = append(impactParts, fmt.Sprintf("%d IPv6 Prefixes", v6Count))
	}

	if len(impactParts) > 0 {
		// Update label to include impact count
		ce.CachedTypeLabel = fmt.Sprintf("[%s] %s", strings.ToUpper(ce.Anom), strings.Join(impactParts, ", "))
		if e.subMonoFace != nil {
			ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
		}
	}

	// Clear FirstLine so only the label (with count) is shown on the first line
	ce.CachedFirstLine = ""
}

func (e *Engine) cacheImpactStrings(ce *CriticalEvent) {
	impactStr := ""
	switch {
	case ce.ImpactedIPs >= 1000000:
		impactStr = fmt.Sprintf("%.1fM IPs", float64(ce.ImpactedIPs)/1000000.0)
	case ce.ImpactedIPs >= 1000:
		impactStr = fmt.Sprintf("%.1fK IPs", float64(ce.ImpactedIPs)/1000.0)
	default:
		impactStr = fmt.Sprintf("%d IPs", ce.ImpactedIPs)
	}

	prefixes := make([]string, 0, len(ce.ImpactedPrefixes))
	for p := range ce.ImpactedPrefixes {
		prefixes = append(prefixes, p)
	}
	sort.Strings(prefixes)

	pfxStr := ""
	if len(prefixes) > 0 {
		pfxStr = prefixes[0]
		if len(prefixes) > 1 {
			pfxStr += fmt.Sprintf(" (%d more)", len(prefixes)-1)
		}
	}

	ce.CachedImpactStr = fmt.Sprintf("  Impact(%s): %s", impactStr, pfxStr)
}

func (e *Engine) drawGlitchImage(screen, img *ebiten.Image, tx, ty, intensity float64, isGlitching bool) {
	if img == nil {
		return
	}
	op := &ebiten.DrawImageOptions{}
	if isGlitching && rand.Float64() < intensity {
		// More aggressive chromatic aberration
		offset := 8.0 * intensity
		jx := (rand.Float64() - 0.5) * 12.0 * intensity
		jy := (rand.Float64() - 0.5) * 4.0 * intensity

		op.GeoM.Reset()
		op.GeoM.Translate(tx+jx+offset, ty+jy)
		op.ColorScale.Reset()
		op.ColorScale.Scale(1, 0, 0, 0.6)
		screen.DrawImage(img, op)

		op.GeoM.Reset()
		op.GeoM.Translate(tx+jx-offset, ty+jy)
		op.ColorScale.Reset()
		op.ColorScale.Scale(0, 1, 1, 0.6)
		screen.DrawImage(img, op)

		// Occasional white flash
		if rand.Float64() < 0.2*intensity {
			op.GeoM.Reset()
			op.GeoM.Translate(tx+jx, ty+jy)
			op.ColorScale.Reset()
			op.ColorScale.Scale(1, 1, 1, 0.3)
			op.Blend = ebiten.BlendLighter
			screen.DrawImage(img, op)
		}
	}

	jx, jy := 0.0, 0.0
	alpha := float32(1.0)
	if isGlitching && rand.Float64() < intensity {
		jx = (rand.Float64() - 0.5) * 6.0 * intensity
		jy = (rand.Float64() - 0.5) * 3.0 * intensity
		alpha = float32(0.4 + rand.Float64()*0.6)
	}
	op.GeoM.Reset()
	op.GeoM.Translate(tx+jx, ty+jy)
	op.ColorScale.Reset()
	op.ColorScale.Scale(1, 1, 1, alpha)
	op.Blend = ebiten.BlendSourceOver
	screen.DrawImage(img, op)
}

func (e *Engine) getClassificationVisuals(classificationType bgp.ClassificationType) (visualColor color.RGBA, classificationName string, shape EventShape) {
	switch classificationType {
	case bgp.ClassificationNone:
		return ColorDiscovery, bgp.NameDiscovery, ShapeCircle
	case bgp.ClassificationDiscovery:
		return ColorDiscovery, bgp.NameDiscovery, ShapeCircle
	case bgp.ClassificationPathHunting:
		return ColorPolicy, bgp.NamePathHunting, ShapeCircle
	case bgp.ClassificationFlap:
		return ColorBad, bgp.NameFlap, ShapeCircle
	case bgp.ClassificationOutage:
		return ColorOutage, bgp.NameHardOutage, ShapeCircle
	case bgp.ClassificationRouteLeak:
		return ColorCritical, bgp.NameRouteLeak, ShapeCircle
	case bgp.ClassificationHijack:
		return ColorCritical, bgp.NameHijack, ShapeFlare
	case bgp.ClassificationBogon:
		return ColorCritical, bgp.NameBogon, ShapeFlare
	case bgp.ClassificationDDoSMitigation:
		return ColorDDoSMitigation, bgp.NameDDoSMitigation, ShapeSquare
	default:
		return color.RGBA{}, "", ShapeCircle
	}
}

func (e *Engine) GetPriority(name string) int {
	switch name {
	case bgp.NameRouteLeak, bgp.NameHardOutage, bgp.NameHijack:
		return 3 // Critical (Red)
	case bgp.NameFlap:
		return 2 // Bad (Orange)
	case bgp.NamePathHunting, bgp.NameDDoSMitigation:
		return 1 // Normalish (Purple)
	default:
		return 0 // Discovery (Blue)
	}
}

func (e *Engine) getClassificationUIColor(name string) color.RGBA {
	switch name {
	case bgp.NameRouteLeak, bgp.NameHardOutage, bgp.NameHijack:
		return ColorWithUI
	case bgp.NameFlap:
		return ColorBad // Already pretty bright
	case bgp.NamePathHunting, bgp.NameDDoSMitigation:
		return ColorUpdUI
	default:
		return ColorGossipUI
	}
}

func (e *Engine) StartMemoryWatcher() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		for range ticker.C {
			debug.FreeOSMemory()
		}
	}()
}

func (e *Engine) InitPulseTexture() {
	size := 256
	e.pulseImage = ebiten.NewImage(size, size)
	pixels := make([]byte, size*size*4)
	center, maxDist := float64(size)/2.0, float64(size)/2.0
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx, dy := float64(x)-center, float64(y)-center
			dist := math.Sqrt(dx*dx + dy*dy)
			if dist < maxDist {
				val, outer, inner := 0.0, 0.9, 0.8
				if e.Width > 2000 {
					outer, inner = 0.94, 0.88
				}
				if dist > maxDist*outer {
					val = math.Cos(((dist - maxDist*(outer+((1-outer)/2))) / (maxDist * ((1 - outer) / 2))) * (math.Pi / 2))
				} else if dist > maxDist*inner {
					val = math.Sin(((dist - maxDist*inner) / (maxDist * (outer - inner))) * (math.Pi / 2))
				}
				pixels[(y*size+x)*4+3] = uint8(val * 255)
				pixels[(y*size+x)*4+0], pixels[(y*size+x)*4+1], pixels[(y*size+x)*4+2] = 255, 255, 255
			}
		}
	}
	e.pulseImage.WritePixels(pixels)
}

func (e *Engine) InitFlareTexture() {
	size := 256
	e.flareImage = ebiten.NewImage(size, size)
	flarePixels := e.generateFlarePixels(size)
	e.flareImage.WritePixels(flarePixels)
}

func (e *Engine) InitSquareTexture() {
	size := 256
	e.squareImage = ebiten.NewImage(size, size)
	pixels := make([]byte, size*size*4)
	center, maxDist := float64(size)/2.0, float64(size)/2.0
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx, dy := math.Abs(float64(x)-center), math.Abs(float64(y)-center)
			dist := math.Max(dx, dy)
			if dist < maxDist {
				val, outer, inner := 0.0, 0.9, 0.8
				if e.Width > 2000 {
					outer, inner = 0.94, 0.88
				}
				if dist > maxDist*outer {
					val = math.Cos(((dist - maxDist*(outer+((1-outer)/2))) / (maxDist * ((1 - outer) / 2))) * (math.Pi / 2))
				} else if dist > maxDist*inner {
					val = math.Sin(((dist - maxDist*inner) / (maxDist * (outer - inner))) * (math.Pi / 2))
				}
				pixels[(y*size+x)*4+3] = uint8(val * 255)
				pixels[(y*size+x)*4+0], pixels[(y*size+x)*4+1], pixels[(y*size+x)*4+2] = 255, 255, 255
			}
		}
	}
	e.squareImage.WritePixels(pixels)
}

func (e *Engine) calculateFlareBrightness(rdx, rdy, maxDist, rayThickness float64) float64 {
	dist := math.Sqrt(rdx*rdx + rdy*rdy)
	brightness := 0.0
	if dist < maxDist*0.15 {
		brightness = 1.0
	}
	if math.Abs(rdy) < rayThickness {
		rayIntensity := 1.0 - (math.Abs(rdx) / (maxDist * 1.2))
		if rayIntensity > 0 {
			edgeFalloff := 1.0 - (math.Abs(rdy) / rayThickness)
			brightness = math.Max(brightness, rayIntensity*edgeFalloff)
		}
	}
	if math.Abs(rdx) < rayThickness {
		rayIntensity := 1.0 - (math.Abs(rdy) / (maxDist * 1.2))
		if rayIntensity > 0 {
			edgeFalloff := 1.0 - (math.Abs(rdx) / rayThickness)
			brightness = math.Max(brightness, rayIntensity*edgeFalloff)
		}
	}
	diagDist1 := math.Abs(rdx-rdy) / math.Sqrt(2)
	diagDist2 := math.Abs(rdx+rdy) / math.Sqrt(2)
	if diagDist1 < rayThickness*0.85 {
		diagLen := math.Abs(rdx+rdy) / math.Sqrt(2)
		rayIntensity := 1.0 - (diagLen / (maxDist * 1.6))
		if rayIntensity > 0 {
			edgeFalloff := 1.0 - (diagDist1 / (rayThickness * 0.85))
			brightness = math.Max(brightness, rayIntensity*edgeFalloff*0.9)
		}
	}
	if diagDist2 < rayThickness*0.85 {
		diagLen := math.Abs(rdx-rdy) / math.Sqrt(2)
		rayIntensity := 1.0 - (diagLen / (maxDist * 1.6))
		if rayIntensity > 0 {
			edgeFalloff := 1.0 - (diagDist2 / (rayThickness * 0.85))
			brightness = math.Max(brightness, rayIntensity*edgeFalloff*0.9)
		}
	}
	if brightness > 1.0 {
		brightness = 1.0
	}
	return brightness
}

func (e *Engine) generateFlarePixels(size int) []byte {
	flarePixels := make([]byte, size*size*4)
	centerX, centerY := float64(size)/2.0, float64(size)/2.0
	rayThickness := float64(size) / 20.0
	rotationAngle := 15.0 * math.Pi / 180.0
	cosA, sinA := math.Cos(rotationAngle), math.Sin(rotationAngle)
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			fx, fy := float64(x), float64(y)
			dx, dy := fx-centerX, fy-centerY
			rdx := dx*cosA - dy*sinA
			rdy := dx*sinA + dy*cosA
			brightness := e.calculateFlareBrightness(rdx, rdy, centerX, rayThickness)
			if brightness > 0 {
				idx := (y*size + x) * 4
				flarePixels[idx+0] = uint8(brightness * 255)
				flarePixels[idx+1] = uint8(brightness * 255)
				flarePixels[idx+2] = uint8(brightness * 255)
				flarePixels[idx+3] = uint8(brightness * 255)
			}
		}
	}
	return flarePixels
}

// StartBufferLoop runs a background loop that periodically processes buffered BGP events.
// It aggregates high-frequency events into batches, shuffles them to prevent visual
// clustering, and paces their release into the visual queue to ensure smooth animations.
func (e *Engine) StartBufferLoop() {
	ticker := time.NewTicker(100 * time.Millisecond)
	for range ticker.C {
		nextBatch := e.drainCityBuffer()

		if len(nextBatch) == 0 {
			continue
		}

		e.scheduleVisualPulses(nextBatch)
	}
}

func (e *Engine) drainCityBuffer() []QueuedPulse {
	e.bufferMu.Lock()
	defer e.bufferMu.Unlock()
	var nextBatch []QueuedPulse
	// 2. Convert buffered city activity into discrete pulse events for each color and shape
	for _, d := range e.cityBuffer {
		for pk, count := range d.Counts {
			if count > 0 {
				nextBatch = append(nextBatch, QueuedPulse{Lat: d.Lat, Lng: d.Lng, Color: pk.Color, Count: count, Shape: pk.Shape})
			}
		}
		// Reset and return to pool
		d.Counts = nil
		*d = BufferedCity{}
		e.cityBufferPool.Put(d)
	}
	// Clear the map after iteration to avoid concurrent modification
	e.cityBuffer = make(map[uint64]*BufferedCity)
	return nextBatch
}

func (e *Engine) scheduleVisualPulses(nextBatch []QueuedPulse) {
	// Shuffle the batch so events from different geographic locations are interleaved
	rand.Shuffle(len(nextBatch), func(i, j int) { nextBatch[i], nextBatch[j] = nextBatch[j], nextBatch[i] })

	// Spread the batch evenly across a longer window to smooth out bursts
	// We overlap batches to ensure a continuous flow (every 100ms we add a 300ms batch)
	spreadWindow := 300 * time.Millisecond
	spacing := spreadWindow / time.Duration(len(nextBatch))
	now := e.Now()

	// If we're too far behind (more than 500ms), jump closer to 'now' but keep a small
	// buffer to avoid a hard gap in the visualization.
	if e.nextPulseEmittedAt.Before(now.Add(-500 * time.Millisecond)) {
		e.nextPulseEmittedAt = now.Add(-100 * time.Millisecond)
	}

	e.queueMu.Lock()
	defer e.queueMu.Unlock()
	// Cap the visual backlog to prevent memory exhaustion during massive BGP spikes
	maxQueueSize := MaxVisualQueueSize
	currentSize := len(e.visualQueue)

	if currentSize >= maxQueueSize {
		// Queue is full. Instead of dropping the whole batch, we can try to "thin" the incoming data
		// by merging it into existing entries if possible, or just dropping it silently to avoid log spam.
		e.droppedQueue.Add(uint64(len(nextBatch)))
		return
	}

	// If the queue is getting large, we sample the incoming batch to slow down the growth
	if currentSize > VisualQueueCull {
		// Progressively drop more as we approach the limit
		// e.g. at 50% of Cull, keep all. at 100% of Max, keep none.
		keepRatio := 1.0 - float64(currentSize-VisualQueueCull)/float64(maxQueueSize-VisualQueueCull)
		if keepRatio < 0.1 {
			keepRatio = 0.1 // Always keep at least 10%
		}

		if keepRatio < 1.0 {
			newLen := int(float64(len(nextBatch)) * keepRatio)
			if newLen < len(nextBatch) {
				nextBatch = nextBatch[:newLen]
				if len(nextBatch) > 0 {
					spacing = spreadWindow / time.Duration(len(nextBatch))
				}
			}
		}
	}

	for i, p := range nextBatch {
		// Schedule the pulse to be processed by the Update() loop at a specific time
		p.ScheduledTime = e.nextPulseEmittedAt.Add(time.Duration(i) * spacing)
		e.visualQueue = append(e.visualQueue, p)
	}

	// Advance the next emission baseline by 100ms (the ticker interval),
	// capping the visual backlog to 3 seconds to prevent falling too far behind.
	e.nextPulseEmittedAt = e.nextPulseEmittedAt.Add(100 * time.Millisecond)
	if e.nextPulseEmittedAt.After(now.Add(3 * time.Second)) {
		e.nextPulseEmittedAt = now.Add(3 * time.Second)
	}
}

func (e *Engine) Stop() {
	if e.cancelCtx != nil {
		e.cancelCtx()
	}

	e.bgWg.Wait()

	if e.VideoWriter != nil {
		log.Printf("Closing video writer and finalizing video...")
		if err := e.VideoWriter.Close(); err != nil {
			log.Printf("Error closing video writer: %v", err)
		}
		if e.VideoCmd != nil {
			if err := e.VideoCmd.Wait(); err != nil {
				log.Printf("Error waiting for video encoder: %v", err)
			}
		}
		log.Printf("Video generation complete.")
		e.VideoWriter = nil
	}
}

func (e *Engine) RecordAlert(alert *livemap.Alert) {
	if alert.PercentageIncrease <= 0 {
		return
	}

	e.streamMu.Lock()
	defer e.streamMu.Unlock()

	ct := bgp.ClassificationType(alert.Classification)
	anomName := strings.ToUpper(ct.String())
	cachedTypeLabel := fmt.Sprintf("[%s]", anomName)

	uiCol := e.getClassificationUIColor(ct.String())
	realCol, _, _ := e.getClassificationVisuals(ct)


	locStr := ""
	switch alert.AlertType {
	case livemap.AlertType_ALERT_TYPE_BY_LOCATION:
		if alert.Location != nil && alert.Location.City != "" {
			locStr = fmt.Sprintf("Around %s, %s", alert.Location.City, alert.Location.Country)
		} else if alert.Location != nil {
			locStr = fmt.Sprintf("Radius: %.1f, %.1f", alert.Location.Lat, alert.Location.Lon)
		} else {
			locStr = "Radius: Unknown"
		}
	case livemap.AlertType_ALERT_TYPE_BY_ASN:
		locStr = fmt.Sprintf("AS%d", alert.Asn)
		if alert.AsName != "" {
			locStr = fmt.Sprintf("AS%d - %s", alert.Asn, alert.AsName)
		}
		if alert.Location != nil && alert.Location.City != "" {
			locStr = fmt.Sprintf("%s (%s, %s)", locStr, alert.Location.City, alert.Location.Country)
		}
	case livemap.AlertType_ALERT_TYPE_BY_ORGANIZATION:
		locStr = fmt.Sprintf("Organization: %s", alert.Organization)
		if alert.Location != nil && alert.Location.City != "" {
			locStr = fmt.Sprintf("%s (%s, %s)", locStr, alert.Location.City, alert.Location.Country)
		}
	case livemap.AlertType_ALERT_TYPE_BY_COUNTRY:
		locStr = fmt.Sprintf("Country: %s", alert.Country)
		if alert.Location != nil && alert.Location.City != "" {
			locStr = fmt.Sprintf("%s (%s)", locStr, alert.Location.City)
		}
	}
	if alert.AsnCount > 1 {
		locStr = fmt.Sprintf("%s (Across %d different networks)", locStr, alert.AsnCount)
	}

	metricStr := ""

	formatImpactCount := func(count uint32) string {
		if count >= 1000000 {
			return fmt.Sprintf("%.0fm", float64(count)/1000000.0)
		} else if count >= 1000 {
			return fmt.Sprintf("%.0fk", float64(count)/1000.0)
		}
		return fmt.Sprintf("%d", count)
	}

	if alert.ImpactedIpv4Ips > 0 && alert.ImpactedIpv6Prefixes > 0 {
		cachedTypeLabel = fmt.Sprintf("%s %s IPv4 IPs, %s IPv6 Prefixes", cachedTypeLabel, formatImpactCount(uint32(alert.ImpactedIpv4Ips)), formatImpactCount(alert.ImpactedIpv6Prefixes))
	} else if alert.ImpactedIpv4Ips > 0 {
		cachedTypeLabel = fmt.Sprintf("%s %s IPv4 IPs", cachedTypeLabel, formatImpactCount(uint32(alert.ImpactedIpv4Ips)))
	} else if alert.ImpactedIpv6Prefixes > 0 {
		cachedTypeLabel = fmt.Sprintf("%s %s IPv6 Prefixes", cachedTypeLabel, formatImpactCount(alert.ImpactedIpv6Prefixes))
	} else {
		cachedTypeLabel = fmt.Sprintf("%s %s Events", cachedTypeLabel, formatImpactCount(alert.EventsCount))
	}

	if alert.AsnCount > 1 {
		cachedTypeLabel = fmt.Sprintf("%s across %d networks", cachedTypeLabel, alert.AsnCount)
	}

	metricStr = fmt.Sprintf("%.0f%% increase in last 5m", alert.PercentageIncrease)

	// [ROUTE LEAK] [SUB TYPE] already calculated

	ce := &CriticalEvent{
		Timestamp:       time.Unix(alert.Timestamp, 0),
		Anom:            ct.String(),
		ASN:             alert.Asn,
		ASNStr:          fmt.Sprintf("AS%d", alert.Asn),
		OrgID:           alert.AsName,
		Locations:       locStr,
		Color:           realCol,
		UIColor:         uiCol,
		CachedTypeLabel: cachedTypeLabel,
		CachedFirstLine: metricStr,
		CachedLocVal:    "",
		CachedLocLabel:  "",
		ImpactedIPs:     alert.ImpactedIpv4Ips,
		IsAggregate:     true,
	}

	if ce.Anom != bgp.NameHardOutage && ce.Anom != bgp.NameRouteLeak && ce.Anom != bgp.NameMinorRouteLeak && ce.Anom != bgp.NameHijack {
		ce.Anom = bgp.NameHardOutage
	}

	e.updateCriticalEventCacheStrs(ce)

	if e.subMonoFace != nil {
		ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
	}

	e.criticalQueue = append(e.criticalQueue, ce)
	e.lastCriticalAddedAt = time.Now()
	e.streamDirty = true
}
