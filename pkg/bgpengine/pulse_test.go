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

	// Should be scheduled ~10 seconds in the future
	if first.Sub(now) < 9900*time.Millisecond || first.Sub(now) > 10100*time.Millisecond {
		t.Errorf("Expected first pulse scheduled around 10s in future, got %v", first.Sub(now))
	}

	spread := last.Sub(first)
	// Spacing is 100ms / 100 = 1ms.
	// Last pulse is at 99 * 1ms = 99ms.
	if spread < 95*time.Millisecond || spread > 105*time.Millisecond {
		t.Errorf("Expected spread around 100ms, got %v", spread)
	}

	// Add another batch and check that it is also scheduled ~10s from now
	// However, because we use gapless scheduling, it should start EXACTLY where the previous one ended
	// which is 100ms after the first one started.
	e.scheduleVisualPulses(batch)
	if len(e.visualQueue) != 200 {
		t.Errorf("Expected 200 pulses in queue, got %d", len(e.visualQueue))
	}

	secondBatchFirst := e.visualQueue[100].ScheduledTime
	if secondBatchFirst.Sub(first) < 99*time.Millisecond || secondBatchFirst.Sub(first) > 101*time.Millisecond {
		t.Errorf("Expected second batch to start 100ms after first, got %v", secondBatchFirst.Sub(first))
	}
}

func TestScheduleVisualPulses_Reset(t *testing.T) {
	now := time.Now()
	e := &Engine{
		// Set baseline way in the past (more than 1s)
		nextPulseEmittedAt: now.Add(-20 * time.Second),
	}

	batch := []QueuedPulse{{Lat: 1.0, Lng: 1.0}}
	e.scheduleVisualPulses(batch)

	// It should have reset to around now + 10s
	diff := e.visualQueue[0].ScheduledTime.Sub(now)
	if diff < 9900*time.Millisecond || diff > 10100*time.Millisecond {
		t.Errorf("Expected pulse scheduled around 10s in future, got %v", diff)
	}
}
