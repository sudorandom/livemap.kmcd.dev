package bgpengine

import (
	"testing"
	"time"

	"github.com/sudorandom/bgp-stream/pkg/bgp"
)

func TestEngineCreation(t *testing.T) {
	e := NewEngine(800, 600, 1.0)
	if e == nil {
		t.Fatalf("Expected engine to be created")
	}
	if e.Width != 800 || e.Height != 600 {
		t.Fatalf("Expected width/height 800x600, got %dx%d", e.Width, e.Height)
	}
}

func TestEnginePriority(t *testing.T) {
	e := NewEngine(800, 600, 1.0)
	prio := e.GetPriority(bgp.NameRouteLeak)
	if prio != 3 {
		t.Fatalf("Expected priority 3 for route leak, got %d", prio)
	}
}

func TestEngineNow(t *testing.T) {
	e := NewEngine(800, 600, 1.0)
	now := e.Now()
	if now.IsZero() {
		t.Fatalf("Expected valid time")
	}
	// With video writer
	e.VideoWriter = &dummyCloser{}
	t1 := e.Now()
	time.Sleep(10 * time.Millisecond)
	t2 := e.Now()
	if t1 != t2 {
		t.Fatalf("Expected virtual time to be static unless updated")
	}
}

type dummyCloser struct{}

func (d *dummyCloser) Write(p []byte) (n int, err error) {
	return len(p), nil
}

func (d *dummyCloser) Close() error {
	return nil
}
