// Package main provides the entry point for the BGP Real-Time Map Viewer.
package main

import (
	"flag"
	"log"
	"os"

	"github.com/hajimehoshi/ebiten/v2"
	_ "github.com/hajimehoshi/ebiten/v2/text/v2"
	"github.com/sudorandom/bgp-stream/pkg/bgpengine"
)

var (
	renderWidth        = flag.Int("width", 1920, "Render width")
	renderHeight       = flag.Int("height", 1080, "Render height")
	windowWidth        = flag.Int("win-width", 0, "Window width (0 for same as render)")
	windowHeight       = flag.Int("win-height", 0, "Window height (0 for same as render)")
	scaleFlag          = flag.Float64("scale", 380.0, "Map scale factor")
	tpsFlag            = flag.Int("tps", 30, "Ticks per second")
	hideWindowControls = flag.Bool("hide-controls", false, "Hide window title bar and controls")
	floating           = flag.Bool("floating", false, "Keep window on top")
	hideUI             = flag.Bool("hide-ui", false, "Start with UI hidden (toggle with 'H')")
	minimalUI          = flag.Bool("minimal-ui", false, "Start with minimal UI (toggle with 'M')")
)

func main() {
	flag.Parse()

	log.Printf("Initializing BGP Viewer (%dx%d, Scale: %.1f)...", *renderWidth, *renderHeight, *scaleFlag)

	engine := bgpengine.NewEngine(*renderWidth, *renderHeight, *scaleFlag)
	engine.HideUI = *hideUI
	engine.MinimalUI = *minimalUI

	// 1. Generate initial map background (MUST start before RunGame to avoid thread-safety issues)
	if err := engine.GenerateInitialBackground(); err != nil {
		log.Printf("Warning: Failed to generate background: %v", err)
	}

	// Start data loading and background tasks
	startBackgroundTasks(engine)

	// Run main window loop
	runWindowLoop(engine)
}

func startBackgroundTasks(engine *bgpengine.Engine) {
	// Start all data loading in the background
	go func() {
		// 2. Load the rest of the data (this now starts the gRPC worker)
		if err := engine.LoadRemainingData(); err != nil {
			log.Printf("Fatal: failed to load remaining data: %v", err)
			os.Exit(1)
		}

		go engine.StartMetricsLoop()
	}()

	go engine.StartMemoryWatcher()
}

func runWindowLoop(engine *bgpengine.Engine) {
	ebiten.SetTPS(*tpsFlag)
	ebiten.SetWindowTitle("BGP Real-Time Map Viewer")
	ebiten.SetWindowDecorated(!*hideWindowControls)
	ebiten.SetWindowFloating(*floating)
	ebiten.SetRunnableOnUnfocused(true)

	w, h := *windowWidth, *windowHeight
	if w == 0 {
		w = *renderWidth
	}
	if h == 0 {
		h = *renderHeight
	}

	ebiten.SetWindowSize(w, h)
	ebiten.SetWindowResizingMode(ebiten.WindowResizingModeEnabled)
	log.Println("Starting ebiten game loop...")
	if err := ebiten.RunGame(engine); err != nil {
		log.Fatal(err)
	}

	engine.Stop()
}
