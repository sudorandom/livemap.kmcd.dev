package bgpengine

import (
	"image/color"
	"testing"
	"time"
)

func TestScheduleVisualPulses(t *testing.T) {
	e := &Engine{
		nextPulseEmittedAt: time.Now(),
	}

	// Create a batch of 100 pulses
	batch := make([]QueuedPulse, 100)
	for i := range batch {
		batch[i] = QueuedPulse{Lat: 1.0, Lng: 1.0, Color: color.RGBA{255, 0, 0, 255}}
	}

	start := e.nextPulseEmittedAt
	e.scheduleVisualPulses(batch)

	if len(e.visualQueue) != 100 {
		t.Errorf("Expected 100 pulses in queue, got %d", len(e.visualQueue))
	}

	// Check the spread
	first := e.visualQueue[0].ScheduledTime
	last := e.visualQueue[99].ScheduledTime

	spread := last.Sub(first)
	// The last pulse is at (n-1)*spacing.
	// Spacing is 300ms / 100 = 15ms.
	// Last pulse is at 99 * 15ms = 1485ms.
	if spread < 290*time.Millisecond || spread > 310*time.Millisecond {
		t.Errorf("Expected spread around 300ms, got %v", spread)
	}

	// Check if nextPulseEmittedAt advanced by 100ms
	if e.nextPulseEmittedAt.Sub(start) != 100*time.Millisecond {
		t.Errorf("Expected nextPulseEmittedAt to advance by 100ms, got %v", e.nextPulseEmittedAt.Sub(start))
	}

	// Add another batch and check overlap
	e.scheduleVisualPulses(batch)
	if len(e.visualQueue) != 200 {
		t.Errorf("Expected 200 pulses in queue, got %d", len(e.visualQueue))
	}

	// The first pulse of the second batch should start at start + 100ms
	secondBatchFirst := e.visualQueue[100].ScheduledTime
	if secondBatchFirst.Sub(start) != 100*time.Millisecond {
		t.Errorf("Expected second batch to start at 100ms, got %v", secondBatchFirst.Sub(start))
	}
}

func TestScheduleVisualPulses_Reset(t *testing.T) {
	now := time.Now()
	e := &Engine{
		// Set baseline way in the past (more than 1s)
		nextPulseEmittedAt: now.Add(-5 * time.Second),
	}

	batch := []QueuedPulse{{Lat: 1.0, Lng: 1.0}}
	e.scheduleVisualPulses(batch)

	// It should have reset to now - 100ms, then advanced by 100ms
	// so it should be around 'now'
	diff := e.nextPulseEmittedAt.Sub(now)
	if diff < -100*time.Millisecond || diff > 100*time.Millisecond {
		t.Errorf("Expected nextPulseEmittedAt to be around now, got %v", diff)
	}
}
