package bgpengine

import (
	"image/color"
	"testing"
	"time"
)

func TestScheduleVisualPulses(t *testing.T) {
	e := &Engine{
		// Note: We don't set nextPulseEmittedAt here so it initializes to zero
	}

	// Create a batch of 100 pulses
	batch := make([]QueuedPulse, 100)
	for i := range batch {
		batch[i] = QueuedPulse{Lat: 1.0, Lng: 1.0, Color: color.RGBA{255, 0, 0, 255}}
	}

	now := time.Now()
	e.scheduleVisualPulses(batch)

	if len(e.visualQueue) != 100 {
		t.Errorf("Expected 100 pulses in queue, got %d", len(e.visualQueue))
	}

	// Check the spread
	first := e.visualQueue[0].ScheduledTime
	last := e.visualQueue[99].ScheduledTime

	// Should be scheduled ~5 seconds in the future
	if first.Sub(now) < 4900*time.Millisecond || first.Sub(now) > 5100*time.Millisecond {
		t.Errorf("Expected first pulse scheduled around 5s in future, got %v", first.Sub(now))
	}

	spread := last.Sub(first)
	// Spacing is 100ms / 100 = 1ms.
	// Last pulse is at 99 * 1ms = 99ms.
	if spread < 95*time.Millisecond || spread > 105*time.Millisecond {
		t.Errorf("Expected spread around 100ms, got %v", spread)
	}

	// Add another batch and check that it is also scheduled ~5s from now
	e.scheduleVisualPulses(batch)
	if len(e.visualQueue) != 200 {
		t.Errorf("Expected 200 pulses in queue, got %d", len(e.visualQueue))
	}

	secondBatchFirst := e.visualQueue[100].ScheduledTime
	if secondBatchFirst.Sub(now) < 4900*time.Millisecond || secondBatchFirst.Sub(now) > 5100*time.Millisecond {
		t.Errorf("Expected second batch scheduled around 5s in future, got %v", secondBatchFirst.Sub(now))
	}
}

func TestScheduleVisualPulses_Reset(t *testing.T) {
	now := time.Now()
	e := &Engine{
		// Set baseline way in the past (more than 1s)
		nextPulseEmittedAt: now.Add(-10 * time.Second),
	}

	batch := []QueuedPulse{{Lat: 1.0, Lng: 1.0}}
	e.scheduleVisualPulses(batch)

	// It should have reset to around now + 5s
	diff := e.visualQueue[0].ScheduledTime.Sub(now)
	if diff < 4900*time.Millisecond || diff > 5100*time.Millisecond {
		t.Errorf("Expected pulse scheduled around 5s in future, got %v", diff)
	}
}
