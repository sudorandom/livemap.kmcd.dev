package bgpengine

import (
	"context"
	"fmt"
	"io"
	"log"
	"sort"
	"time"

	"github.com/hajimehoshi/ebiten/v2/text/v2"
	"github.com/sudorandom/bgp-stream/pkg/bgp"
	"github.com/sudorandom/bgp-stream/pkg/livemap"
	"github.com/sudorandom/bgp-stream/pkg/utils"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func (e *Engine) StartGRPCWorker(addr string) {
	go func() {
		for {
			if err := e.runGRPCClient(addr); err != nil {
				log.Printf("[GRPC] Error: %v. Retrying in 5s...", err)
				time.Sleep(5 * time.Second)
			}
		}
	}()
}

func (e *Engine) runGRPCClient(addr string) error {
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer conn.Close()

	client := livemap.NewLiveMapClient(conn)

	// Create a context that is canceled when this connection loop exits
	ctx, cancel := context.WithCancel(e.ctx)
	defer cancel()

	// 1. Start Summary Polling
	go e.pollSummary(ctx, client)

	// 2. Start Event Stream
	return e.consumeEventStream(ctx, client)
}

func (e *Engine) pollSummary(ctx context.Context, client livemap.LiveMapClient) {
	ticker := time.NewTicker(800 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			resp, err := client.GetSummary(ctx, &livemap.SummaryRequest{})
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("[GRPC] Failed to get summary: %v", err)
				}
				return // Exit polling loop on error to let runGRPCClient reconnect
			}
			e.updateFromSummary(resp)
		}
	}
}

func (e *Engine) updateFromSummary(resp *livemap.SummaryResponse) {
	e.metricsMu.Lock()
	defer e.metricsMu.Unlock()

	// 1. Initialize with all types we want to show
	allTypes := []bgp.ClassificationType{
		bgp.ClassificationHijack,
		bgp.ClassificationRouteLeak,
		bgp.ClassificationOutage,
		bgp.ClassificationFlap,
		bgp.ClassificationTrafficEngineering,
		bgp.ClassificationPathHunting,
		bgp.ClassificationDDoSMitigation,
		bgp.ClassificationDiscovery,
	}

	newPrefixCounts := make([]PrefixCount, 0, len(allTypes))
	for _, ct := range allTypes {
		name := ct.String()
		newPrefixCounts = append(newPrefixCounts, PrefixCount{
			Name:     name,
			Type:     ct,
			Color:    e.getClassificationUIColor(name),
			Priority: e.GetPriority(name),
		})
	}

	var goodIPs, polyIPs, badIPs, critIPs uint64
	snap := MetricSnapshot{}

	for _, pc := range resp.ClassificationCounts {
		ct := bgp.ClassificationType(pc.Classification)
		// Group None (0) and Discovery (9) together
		if ct == bgp.ClassificationNone {
			ct = bgp.ClassificationDiscovery
		}

		// Hide Bogon
		if ct == bgp.ClassificationBogon {
			continue
		}

		// Find existing entry
		var pcEntry *PrefixCount
		for i := range newPrefixCounts {
			if newPrefixCounts[i].Type == ct {
				pcEntry = &newPrefixCounts[i]
				break
			}
		}

		if pcEntry != nil {
			pcEntry.MsgCount += int(pc.TotalCount)
			pcEntry.Rate += float64(pc.MessagesPerSecond)
			if int(pc.AsnCount) > pcEntry.ASNCount {
				pcEntry.ASNCount = int(pc.AsnCount)
			}
			if int(pc.PrefixCount) > pcEntry.PfxCount {
				pcEntry.PfxCount = int(pc.PrefixCount)
			}
			if pc.Ipv4Count > pcEntry.IPCount {
				pcEntry.IPCount = pc.Ipv4Count
			}
		}

		// Update snapshot for trendlines (using the windowed pc.Count)
		switch ct {
		case bgp.ClassificationDiscovery:
			goodIPs += pc.Ipv4Count
			snap.Global += int(pc.Count)
		case bgp.ClassificationTrafficEngineering:
			polyIPs += pc.Ipv4Count
			snap.TE += int(pc.Count)
		case bgp.ClassificationPathHunting:
			polyIPs += pc.Ipv4Count
			snap.Hunting += int(pc.Count)
		case bgp.ClassificationDDoSMitigation:
			polyIPs += pc.Ipv4Count
			snap.DDoS += int(pc.Count)
		case bgp.ClassificationFlap:
			badIPs += pc.Ipv4Count
			snap.Flap += int(pc.Count)
		case bgp.ClassificationOutage:
			critIPs += pc.Ipv4Count
			snap.Outage += int(pc.Count)
		case bgp.ClassificationRouteLeak:
			critIPs += pc.Ipv4Count
			snap.Leak += int(pc.Count)
		case bgp.ClassificationHijack:
			critIPs += pc.Ipv4Count
			snap.Hijack += int(pc.Count)
		}
	}

	snap.GoodIPs = goodIPs
	snap.PolyIPs = polyIPs
	snap.BadIPs = badIPs
	snap.CritIPs = critIPs

	// Sort newPrefixCounts by priority (descending, since Red/Crit is likely higher priority)
	sort.Slice(newPrefixCounts, func(i, j int) bool {
		if newPrefixCounts[i].Priority != newPrefixCounts[j].Priority {
			return newPrefixCounts[i].Priority > newPrefixCounts[j].Priority
		}
		return newPrefixCounts[i].MsgCount > newPrefixCounts[j].MsgCount
	})

	// Finalize strings and measurements for grouped counts
	for i := range newPrefixCounts {
		p := &newPrefixCounts[i]
		p.RateStr = fmt.Sprintf("%.1f", p.Rate)
		p.MsgStr = utils.FormatShortNumber(uint64(p.MsgCount))
		p.ASNStr = fmt.Sprintf("%d", p.ASNCount)
		p.PfxStr = utils.FormatShortNumber(uint64(p.PfxCount))
		p.IPStr = utils.FormatShortNumber(p.IPCount)

		if e.subMonoFace != nil {
			p.RateWidth, _ = text.Measure(p.RateStr, e.subMonoFace, 0)
			p.ASNWidth, _ = text.Measure(p.ASNStr, e.subMonoFace, 0)
			p.PfxWidth, _ = text.Measure(p.PfxStr, e.subMonoFace, 0)
			p.IPWidth, _ = text.Measure(p.IPStr, e.subMonoFace, 0)
		}
	}

	e.prefixCounts = newPrefixCounts
	e.lastMetricsUpdate = time.Now()
	e.impactDirty = true
	e.loadingHistorical = resp.GetLoadingHistorical()
}

func (e *Engine) consumeEventStream(ctx context.Context, client livemap.LiveMapClient) error {
	stream, err := client.SubscribeEvents(ctx, &livemap.StreamEventsRequest{})
	if err != nil {
		return err
	}

	log.Println("[GRPC] Subscribed to event stream")
	for {
		resp, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		for _, ev := range resp.Events {
			if ev.Geo == nil {
				continue
			}

			// Directly record pulses based on aggregated events from gRPC
			ct := bgp.ClassificationType(ev.Classification)
			if ct == bgp.ClassificationNone {
				ct = bgp.ClassificationDiscovery
			}

			count := int(ev.Count)
			if count > 100 {
				count = 100 // Cap visual pulses per aggregate to avoid lag
			}

			for i := 0; i < count; i++ {
				e.recordEvent(
					float64(ev.Geo.Lat),
					float64(ev.Geo.Lon),
					"", "", // CC and City not used for pulses
					bgp.EventUpdate, // Default to update for now
					ct,
					"", 0, 0, nil, nil, // Other fields not needed for simple pulse
				)
			}
		}
	}
}
