package bgpengine

import (
	"fmt"
	"image/color"
	"math"
	"strings"
	"time"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/text/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"github.com/sudorandom/bgp-stream/pkg/bgp"
	livemap "github.com/sudorandom/bgp-stream/pkg/livemap/v1"
	"github.com/sudorandom/bgp-stream/pkg/utils"
)

type legendRow struct {
	label    string
	val      float64
	col      color.RGBA
	uiCol    color.RGBA
	accessor func(s MetricSnapshot) float64
}

func (e *Engine) DrawBGPStatus(screen *ebiten.Image) {
	if e.fontSource == nil {
		return
	}
	margin, fontSize := 40.0, 18.0
	if e.Width > 2000 {
		margin, fontSize = 80.0, 36.0
	}

	boxW := 280.0
	if e.Width > 2000 {
		boxW = 560.0
	}

	// 1. Left Column: Interchanging Stream (Major Routing Anomalies <-> Top Flappiest Networks)
	e.streamMu.Lock()
	maxStreamH := (float64(e.Height) - margin*2) * 0.45
	yBase := float64(e.Height) - (margin - 10) - maxStreamH
	e.drawLeftPanel(screen, margin-10, yBase, boxW*1.4, maxStreamH, fontSize)
	e.streamMu.Unlock()

	e.metricsMu.Lock()
	defer e.metricsMu.Unlock()

	// 2. Top Right: Now Playing
	e.drawNowPlaying(screen, margin, boxW, fontSize, e.face)

	// 3. Bottom Right: Legend, Anomaly Summary & Trendlines
	e.drawLegendAndTrends(screen)

	// 4. Bottom Center: RPKI Status centered horizontally between Left Panel and Right Panel
	e.drawRPKIStatus(screen, margin, boxW, fontSize)

	e.drawDisconnected(screen)
}

func (e *Engine) calculateSummaryBoxHeight(fontSize float64) float64 {
	totalHeight := fontSize + 30.0 // Header

	if len(e.prefixCounts) > 0 {
		totalHeight += fontSize * 1.1                                // Column Headers
		totalHeight += float64(len(e.prefixCounts)) * fontSize * 1.0 // Rows
	} else {
		totalHeight += fontSize * 1.5 // "No anomalies detected"
	}

	totalHeight += 10.0 // Bottom padding
	return totalHeight
}

func (e *Engine) drawAnomalySummary(screen *ebiten.Image, xBase, yBase, boxW, boxH, fontSize float64) {
	// boxW is scaled by 1.5 in the caller
	scaledBoxW := boxW * 1.5
	if e.impactBuffer == nil || e.impactBuffer.Bounds().Dx() != int(scaledBoxW) || e.impactBuffer.Bounds().Dy() != int(boxH) {
		e.impactBuffer = ebiten.NewImage(int(scaledBoxW), int(boxH))
		e.impactDirty = true
	}

	if e.impactDirty {
		e.impactBuffer.Clear()

		localX, localY := 10.0, fontSize+15.0
		vector.FillRect(e.impactBuffer, 0, 0, float32(scaledBoxW), float32(boxH), color.RGBA{0, 0, 0, 100}, false)
		vector.StrokeRect(e.impactBuffer, 0, 0, float32(scaledBoxW), float32(boxH), 1, color.RGBA{36, 42, 53, 255}, false)

		impactTitle := "BGP STATE SUMMARY"
		if e.loadingHistorical {
			impactTitle = "BGP STATE SUMMARY [BACKFILLING DATABASE...]"
		}
		vector.FillRect(e.impactBuffer, 0, 0, 4, float32(fontSize+10), ColorNew, false)

		textOp := &text.DrawOptions{}
		textOp.GeoM.Translate(localX+5, localY-fontSize-5)
		textOp.ColorScale.Scale(1, 1, 1, 0.5)
		text.Draw(e.impactBuffer, impactTitle, e.titleFace, textOp)

		e.drawAnomalySummaryContent(localX, localY, scaledBoxW, fontSize, textOp)
		e.impactDirty = false
	}

	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(xBase-10, yBase)
	screen.DrawImage(e.impactBuffer, op)
}

func (e *Engine) drawAnomalySummaryContent(localX, localY, scaledBoxW, fontSize float64, textOp *text.DrawOptions) {
	currentY := localY + 2.0
	// Layout:
	//              [RATE] [ASNS] |   IPv4    | IPv6
	// [ICON] [TYPE]              | PFXs | IPs | PFXs
	col1X := localX + 5.0 + (fontSize * 1.2)
	col6X := localX + scaledBoxW - 45.0
	col5X := col6X - 60.0
	col4X := col5X - 60.0
	col3X := col4X - 60.0
	col2X := col3X - 70.0

	if e.Width > 2000 {
		col6X = localX + scaledBoxW - 90.0
		col5X = col6X - 120.0
		col4X = col5X - 120.0
		col3X = col4X - 120.0
		col2X = col3X - 140.0
	}

	textOp.ColorScale.Reset()
	textOp.ColorScale.Scale(1, 1, 1, 0.4)

	// Section Headers (Top row)
	hIPv4 := "IPv4"
	hwIPv4, _ := text.Measure(hIPv4, e.subMonoFace, 0)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate((col4X+col5X)/2-hwIPv4/2, currentY)
	text.Draw(e.impactBuffer, hIPv4, e.subMonoFace, textOp)

	hIPv6 := "IPv6"
	hwIPv6, _ := text.Measure(hIPv6, e.subMonoFace, 0)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate(col6X-hwIPv6/2, currentY)
	text.Draw(e.impactBuffer, hIPv6, e.subMonoFace, textOp)

	currentY += (fontSize * 0.8) + 3.0

	// Sub-Headers (Second row)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate(col1X, currentY)
	text.Draw(e.impactBuffer, "TYPE", e.subMonoFace, textOp)

	hRate := "MSG/s"
	hwRate, _ := text.Measure(hRate, e.subMonoFace, 0)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate(col2X-hwRate/2, currentY)
	text.Draw(e.impactBuffer, hRate, e.subMonoFace, textOp)

	h1 := "ASNs"
	hw1, _ := text.Measure(h1, e.subMonoFace, 0)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate(col3X-hw1/2, currentY)
	text.Draw(e.impactBuffer, h1, e.subMonoFace, textOp)

	h2 := "PFXs"
	hw2, _ := text.Measure(h2, e.subMonoFace, 0)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate(col4X-hw2/2, currentY)
	text.Draw(e.impactBuffer, h2, e.subMonoFace, textOp)

	h3 := "IPs"
	hw3, _ := text.Measure(h3, e.subMonoFace, 0)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate(col5X-hw3/2, currentY)
	text.Draw(e.impactBuffer, h3, e.subMonoFace, textOp)

	h4 := "PFXs"
	hw4, _ := text.Measure(h4, e.subMonoFace, 0)
	textOp.GeoM.Reset()
	textOp.GeoM.Translate(col6X-hw4/2, currentY)
	text.Draw(e.impactBuffer, h4, e.subMonoFace, textOp)

	currentY += fontSize * 1.1

	for i := range e.prefixCounts {
		pc := &e.prefixCounts[i]

		// Draw Swatch/Icon
		mapCol, _, mapShape := e.getClassificationVisuals(pc.Type)
		imgToDraw := e.pulseImage
		switch mapShape {
		case ShapeFlare:
			imgToDraw = e.flareImage
		case ShapeSquare:
			imgToDraw = e.squareImage
		case ShapeTriangle:
			imgToDraw = e.triangleImage
		}

		swatchSize := fontSize * 0.8
		cr, cg, cb := float32(mapCol.R)/255.0, float32(mapCol.G)/255.0, float32(mapCol.B)/255.0
		baseAlpha := float32(0.6)
		if mapShape == ShapeFlare {
			baseAlpha = 1.0
		}
		if pc.IPCount == 0 && pc.Rate == 0 {
			baseAlpha *= 0.3
		}

		imgWidth := float64(imgToDraw.Bounds().Dx())
		halfWidth := imgWidth / 2
		op := &ebiten.DrawImageOptions{}
		op.Blend = ebiten.BlendLighter
		scale := swatchSize / imgWidth
		op.GeoM.Translate(-halfWidth, -halfWidth)
		op.GeoM.Scale(scale, scale)
		op.GeoM.Translate(localX+5+(swatchSize/2), currentY+(fontSize/2))
		op.ColorScale.Scale(cr*baseAlpha, cg*baseAlpha, cb*baseAlpha, baseAlpha)
		e.impactBuffer.DrawImage(imgToDraw, op)

		// Anomaly Name
		textOp.GeoM.Reset()
		textOp.GeoM.Translate(col1X, currentY)
		textOp.ColorScale.Reset()
		if pc.IPCount > 0 || pc.Rate > 0 {
			textOp.ColorScale.ScaleWithColor(pc.Color)
		} else {
			textOp.ColorScale.ScaleWithColor(pc.Color)
			textOp.ColorScale.Scale(0.5, 0.5, 0.5, 0.1) // Much more faded
		}
		text.Draw(e.impactBuffer, pc.Name, e.subMonoFace, textOp)

		// Rate
		textOp.GeoM.Reset()
		textOp.GeoM.Translate(col2X-pc.RateWidth/2, currentY)
		textOp.ColorScale.Reset()
		if pc.IPCount > 0 || pc.Rate > 0 {
			textOp.ColorScale.ScaleWithColor(pc.Color)
		} else {
			textOp.ColorScale.ScaleWithColor(pc.Color)
			textOp.ColorScale.Scale(0.5, 0.5, 0.5, 0.1)
		}
		text.Draw(e.impactBuffer, pc.RateStr, e.subMonoFace, textOp)

		// ASN Count
		textOp.GeoM.Reset()
		textOp.GeoM.Translate(col3X-pc.ASNWidth/2, currentY)
		textOp.ColorScale.Reset()
		if pc.IPCount > 0 || pc.Rate > 0 {
			textOp.ColorScale.ScaleWithColor(pc.Color)
		} else {
			textOp.ColorScale.ScaleWithColor(pc.Color)
			textOp.ColorScale.Scale(0.5, 0.5, 0.5, 0.1)
		}
		text.Draw(e.impactBuffer, pc.ASNStr, e.subMonoFace, textOp)

		// Prefix Count (v4)
		textOp.GeoM.Reset()
		textOp.GeoM.Translate(col4X-pc.IPv4PfxWidth/2, currentY)
		textOp.ColorScale.Reset()
		if pc.IPCount > 0 || pc.Rate > 0 {
			textOp.ColorScale.ScaleWithColor(pc.Color)
		} else {
			textOp.ColorScale.ScaleWithColor(pc.Color)
			textOp.ColorScale.Scale(0.5, 0.5, 0.5, 0.1)
		}
		text.Draw(e.impactBuffer, pc.IPv4PfxStr, e.subMonoFace, textOp)

		// IPv4 Count
		textOp.GeoM.Reset()
		textOp.GeoM.Translate(col5X-pc.IPWidth/2, currentY)
		textOp.ColorScale.Reset()
		if pc.IPCount > 0 || pc.Rate > 0 {
			textOp.ColorScale.ScaleWithColor(pc.Color)
		} else {
			textOp.ColorScale.ScaleWithColor(pc.Color)
			textOp.ColorScale.Scale(0.5, 0.5, 0.5, 0.1)
		}
		text.Draw(e.impactBuffer, pc.IPStr, e.subMonoFace, textOp)

		// IPv6 Prefix Count
		textOp.GeoM.Reset()
		textOp.GeoM.Translate(col6X-pc.IPv6PfxWidth/2, currentY)
		textOp.ColorScale.Reset()
		if pc.IPCount > 0 || pc.IPv6PfxCount > 0 || pc.Rate > 0 {
			textOp.ColorScale.ScaleWithColor(pc.Color)
		} else {
			textOp.ColorScale.ScaleWithColor(pc.Color)
			textOp.ColorScale.Scale(0.5, 0.5, 0.5, 0.1)
		}
		text.Draw(e.impactBuffer, pc.IPv6PfxStr, e.subMonoFace, textOp)

		currentY += fontSize * 1.0
	}
}

func (e *Engine) drawLeftPanel(screen *ebiten.Image, margin, yBase, boxW, boxH, fontSize float64) {
	actualW := boxW * 1.1
	if e.streamBuffer == nil || e.streamBuffer.Bounds().Dx() != int(actualW) || e.streamBuffer.Bounds().Dy() != int(boxH) {
		e.streamBuffer = ebiten.NewImage(int(actualW), int(boxH))
	}

	now := e.Now()

	// Default to whatever we were currently aiming for
	desiredView := e.targetLeftViewIndex

	timeSincePromoted := now.Sub(e.lastCriticalPromotedAt)

	if timeSincePromoted < 15*time.Second && len(e.CriticalStream) > 0 {
		// Prioritize Major Anomalies if a critical event was recently promoted
		desiredView = 0
	} else if now.Sub(e.leftViewChangedAt) > 25*time.Second {
		// Otherwise, rotate views every 25 seconds
		desiredView = (e.targetLeftViewIndex + 1) % 2
	}

	// If there are no major anomalies, default to flappiest networks
	if len(e.CriticalStream) == 0 && (len(e.topFlappiestNetworks) > 0 || e.topStatsFlappiestASN != 0) {
		desiredView = 1
	}

	if e.targetLeftViewIndex != desiredView {
		e.targetLeftViewIndex = desiredView
		e.leftViewChangedAt = now
	}

	timeSinceChange := now.Sub(e.leftViewChangedAt).Seconds()
	var fadeAlpha float32
	fadeDuration := 0.5 // 0.5s fade out, 0.5s fade in

	if timeSinceChange < fadeDuration {
		// Fading out old view
		fadeAlpha = float32(1.0 - (timeSinceChange / fadeDuration))
	} else if timeSinceChange < fadeDuration*2.0 {
		// Switch to new view and fade in
		if e.currentLeftViewIndex != e.targetLeftViewIndex {
			e.currentLeftViewIndex = e.targetLeftViewIndex
			e.streamDirty = true
		}
		fadeAlpha = float32((timeSinceChange - fadeDuration) / fadeDuration)
	} else {
		// Fully visible
		if e.currentLeftViewIndex != e.targetLeftViewIndex {
			e.currentLeftViewIndex = e.targetLeftViewIndex
			e.streamDirty = true
		}
		fadeAlpha = 1.0
	}

	localX, localY := 10.0, fontSize+15.0

	// 1. Recompose the stream buffer
	e.streamBuffer.Clear()
	vector.FillRect(e.streamBuffer, 0, 0, float32(actualW), float32(boxH), color.RGBA{0, 0, 0, 110}, false)

	var streamTitle string
	var headerColor color.RGBA
	var tabStr string

	switch e.currentLeftViewIndex {
	case 0:
		streamTitle = "MAJOR ROUTING ANOMALIES"
		headerColor = color.RGBA{255, 50, 50, 255}
		tabStr = "1/2"
		e.renderMajorAnomaliesView(localX, localY, actualW, boxH, fontSize)

	case 1:
		streamTitle = "TOP FLAPPIEST NETWORKS (24H)"
		headerColor = ColorBad
		tabStr = "2/2"
		e.renderFlappiestView(localX, localY, actualW, boxH, fontSize)
	}

	// 2. Draw solid black header to occlude any scrolling text
	vector.FillRect(e.streamBuffer, 0, 0, float32(actualW), float32(localY+5), color.RGBA{0, 0, 0, 255}, false)
	vector.StrokeRect(e.streamBuffer, 0, 0, float32(actualW), float32(boxH), 1, color.RGBA{36, 42, 53, 255}, false)

	// 3. Draw Header accent and title
	vector.FillRect(e.streamBuffer, 0, 0, 4, float32(fontSize+10), headerColor, false)
	textOp := &text.DrawOptions{}
	textOp.GeoM.Translate(localX+5, localY-fontSize-5)
	textOp.ColorScale.Scale(1, 1, 1, 0.7)
	text.Draw(e.streamBuffer, streamTitle, e.titleFace, textOp)

	// 4. Draw tab pagination indicator in upper-right
	tabOp := &text.DrawOptions{}
	tabOp.GeoM.Translate(actualW-45, localY-fontSize-5)
	tabOp.ColorScale.Scale(1, 1, 1, 0.3)
	text.Draw(e.streamBuffer, "["+tabStr+"]", e.subMonoFace, tabOp)

	// 5. Draw directly to screen - with fade effect!
	bufOp := &ebiten.DrawImageOptions{}
	bufOp.GeoM.Translate(margin, yBase)
	bufOp.ColorScale.ScaleAlpha(fadeAlpha)
	screen.DrawImage(e.streamBuffer, bufOp)
}

func (e *Engine) renderMajorAnomaliesView(localX, localY, boxW, boxH, fontSize float64) {
	if len(e.CriticalStream) == 0 {
		textOp := &text.DrawOptions{}
		textOp.GeoM.Translate(localX+5, localY+15)
		textOp.ColorScale.Scale(1, 1, 1, 0.3)
		text.Draw(e.streamBuffer, "Waiting for major anomalies...", e.subMonoFace, textOp)
		return
	}

	eventFontSize := fontSize * 0.75
	visibleH := boxH - localY - 15.0

	clipH := int(boxH * 2.5)
	if clipH < 2000 {
		clipH = 2000
	}
	if e.streamClipBuffer == nil || e.streamClipBuffer.Bounds().Dx() != int(boxW) || e.streamClipBuffer.Bounds().Dy() < clipH {
		e.streamClipBuffer = ebiten.NewImage(int(boxW), clipH)
		e.streamDirty = true
	}

	// 1. Redraw events to clip buffer only when dirty
	if e.streamDirty {
		e.streamClipBuffer.Clear()
		currentY := 0.0

		for i, ce := range e.CriticalStream {
			nextY := e.drawCriticalEvent(ce, localX, currentY, boxW, eventFontSize)
			if i < len(e.CriticalStream)-1 {
				currentY = nextY + 14.0 // Spacing between events without a line
			} else {
				currentY = nextY + 10.0
			}
		}
		e.streamDirty = false
		e.streamContentH = currentY
	}

	// 2. Auto-scrolling logic:
	// If total content height exceeds visible space, scroll down to reveal entries that can't be seen.
	scrollOffset := 0.0
	if e.streamContentH > visibleH {
		maxScroll := e.streamContentH - visibleH
		now := e.Now()
		if e.streamScrollStart.IsZero() {
			e.streamScrollStart = now
		}
		elapsed := now.Sub(e.streamScrollStart).Seconds()

		topPause := 4.0
		scrollDuration := maxScroll / 25.0
		if scrollDuration < 3.0 {
			scrollDuration = 3.0
		}
		bottomPause := 4.0
		returnDuration := 2.0
		cycleDuration := topPause + scrollDuration + bottomPause + returnDuration

		tCycle := math.Mod(elapsed, cycleDuration)
		if tCycle < topPause {
			scrollOffset = 0.0
		} else if tCycle < topPause+scrollDuration {
			progress := (tCycle - topPause) / scrollDuration
			ease := 0.5 - 0.5*math.Cos(progress*math.Pi)
			scrollOffset = ease * maxScroll
		} else if tCycle < topPause+scrollDuration+bottomPause {
			scrollOffset = maxScroll
		} else {
			progress := (tCycle - topPause - scrollDuration - bottomPause) / returnDuration
			ease := 0.5 + 0.5*math.Cos(progress*math.Pi)
			scrollOffset = ease * maxScroll
		}
	}

	// 3. Draw the clip buffer into streamBuffer
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(0, localY+5+e.streamOffset-scrollOffset)
	e.streamBuffer.DrawImage(e.streamClipBuffer, op)
}

func (e *Engine) drawCriticalEvent(ce *CriticalEvent, x, y, boxW, fontSize float64) float64 {
	indent := 10.0
	rightEdge := boxW - 15.0
	textOp := &text.DrawOptions{}

	if ce.CachedTypeWidth == 0 && e.subMonoFace != nil {
		ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
	}

	cr, cg, cb := float32(ce.UIColor.R)/255.0, float32(ce.UIColor.G)/255.0, float32(ce.UIColor.B)/255.0

	title := ce.CachedTypeLabel
	if ce.Resolved {
		title = "[RESOLVED] " + title
	}

	textOp.GeoM.Translate(x, y)
	if ce.Resolved {
		textOp.ColorScale.Scale(0, 1, 0, 0.9)
	} else {
		textOp.ColorScale.Scale(cr, cg, cb, 0.95)
	}

	// 1. Draw Title (wrapped)
	nextY := e.drawWrappedText(e.streamClipBuffer, title, e.subMonoFace, x, y, rightEdge-x, fontSize*1.1, textOp)
	if nextY == y {
		nextY = y + fontSize*1.15
	}

	// 2. Draw Impact / metrics line
	if ce.CachedFirstLine != "" {
		textOp.ColorScale.Reset()
		if (ce.Anom == bgp.NameRouteLeak || ce.Anom == bgp.NameMinorRouteLeak) || ce.Anom == bgp.NameHardOutage || ce.Anom == bgp.NameDDoSMitigation || ce.Anom == bgp.NameHijack {
			if ce.Resolved {
				textOp.ColorScale.Scale(0, 1, 0, 0.9)
			} else {
				textOp.ColorScale.Scale(0, 1, 1, 0.9) // Cyan
			}
		} else {
			textOp.ColorScale.Scale(cr, cg, cb, 0.75)
		}
		nextY = e.drawWrappedText(e.streamClipBuffer, ce.CachedFirstLine, e.subMonoFace, x, nextY, rightEdge-x, fontSize*1.05, textOp)
	}

	labelCol := color.RGBA{170, 170, 170, 255}
	valueCol := color.RGBA{255, 230, 80, 255}

	// 3. Anomaly-specific details
	switch {
	case (ce.Anom == bgp.NameRouteLeak || ce.Anom == bgp.NameMinorRouteLeak || strings.Contains(strings.ToLower(ce.Anom), "route leak")) && !ce.IsAggregate:
		if ce.LeakType != bgp.LeakUnknown {
			nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedLeakerLabel, ce.LeakerRPKI, ce.CachedLeakerVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
			nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedVictimLabel, ce.VictimRPKI, ce.CachedVictimVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
			nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
		}
	case (ce.Anom == bgp.NameHardOutage || strings.Contains(strings.ToLower(ce.Anom), "outage")) && !ce.IsAggregate:
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedASNLabel, ce.CachedASNVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
	case (ce.Anom == bgp.NameDDoSMitigation || ce.Anom == bgp.NameHijack || strings.Contains(strings.ToLower(ce.Anom), "hijack") || strings.Contains(strings.ToLower(ce.Anom), "ddos")) && !ce.IsAggregate:
		nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedLeakerLabel, ce.LeakerRPKI, ce.CachedLeakerVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
		nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedVictimLabel, ce.VictimRPKI, ce.CachedVictimVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
	}

	// 4. Location line
	loc := ce.CachedLocVal
	if loc == "" {
		loc = ce.Locations
	}
	if loc != "" {
		curIndent := indent
		if ce.CachedLocLabel == "" {
			curIndent = 0
		}
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedLocLabel, loc, e.subMonoFace, x+curIndent, nextY, rightEdge-(x+curIndent), fontSize, labelCol, valueCol)
	}

	return nextY
}

func (e *Engine) renderFlappiestView(localX, localY, boxW, boxH, fontSize float64) {
	numItems := len(e.topFlappiestNetworks)
	if numItems == 0 && e.topStatsFlappiestASN == 0 {
		noneOp := &text.DrawOptions{}
		noneOp.GeoM.Translate(localX+5, localY+15)
		noneOp.ColorScale.Scale(1, 1, 1, 0.4)
		text.Draw(e.streamBuffer, "No flapping networks detected", e.subFace, noneOp)
		return
	}

	if numItems > 8 {
		numItems = 8
	}
	if numItems == 0 && e.topStatsFlappiestASN != 0 {
		numItems = 1
	}

	now := e.Now()
	timeSinceChanged := now.Sub(e.flappiestChangedAt).Seconds()
	isAnimating := timeSinceChanged >= 0 && timeSinceChanged <= 3.0

	if isAnimating && timeSinceChanged > 0.2 && timeSinceChanged < 2.8 && e.flappyImage != nil {
		imgW := float64(e.flappyImage.Bounds().Dx())
		imgH := float64(e.flappyImage.Bounds().Dy())
		birdScale := (fontSize * 2.0) / imgW
		scaledBirdH := imgH * birdScale
		birdX := (boxW - imgW*birdScale) / 2.0
		if e.flappyY == 0 {
			e.flappyY = localY + 10.0
		}
		dt := 0.016 // Adjust to 60fps instead of 30fps
		gravity := 450.0
		e.flappyVelocity += gravity * dt
		e.flappyY += e.flappyVelocity * dt
		maxBirdY := boxH - scaledBirdH - 20.0
		if e.flappyY > maxBirdY {
			e.flappyY = maxBirdY
			e.flappyVelocity = -250.0
		}
		minBirdY := localY + 10.0
		if e.flappyY < minBirdY {
			e.flappyY = minBirdY
			e.flappyVelocity = 0
		}
		op := &ebiten.DrawImageOptions{}
		op.GeoM.Scale(birdScale, birdScale)
		op.GeoM.Translate(birdX, e.flappyY)
		e.streamBuffer.DrawImage(e.flappyImage, op)
		return
	}

	currY := localY + 12.0
	itemH := fontSize * 2.8

	for i := 0; i < numItems; i++ {
		if currY+itemH > boxH-15.0 {
			break
		}

		var f *livemap.FlappiestNetworkStats
		if i < len(e.topFlappiestNetworks) {
			f = e.topFlappiestNetworks[i]
		} else {
			f = &livemap.FlappiestNetworkStats{
				Asn:         e.topStatsFlappiestASN,
				NetworkName: e.topStatsFlappiestOrg,
				Prefix:      e.topStatsFlappiestPrefix,
				FlapCount:   e.topStatsFlappiestFlapCount,
				EventRate:   e.topStatsFlappyEventRate,
			}
		}

		// Line 1: Rank + Prefix on left, Flap count on right
		pfxOp := &text.DrawOptions{}
		pfxOp.GeoM.Translate(localX, currY)
		pfxOp.ColorScale.Scale(1, 1, 1, 0.95)
		rankPrefix := fmt.Sprintf("%d. %s", i+1, f.GetPrefix())
		text.Draw(e.streamBuffer, rankPrefix, e.boldFace, pfxOp)

		flapStr := fmt.Sprintf("%s flaps", utils.FormatShortNumber(uint64(f.GetFlapCount())))
		if f.GetEventRate() > 0 {
			flapStr = fmt.Sprintf("%s flaps (%.1f/s)", utils.FormatShortNumber(uint64(f.GetFlapCount())), f.GetEventRate())
		}
		flapOp := &text.DrawOptions{}
		tw, _ := text.Measure(flapStr, e.subMonoFace, 0)
		flapOp.GeoM.Translate(boxW-15.0-tw, currY+fontSize*0.1)
		flapOp.ColorScale.Scale(1, 0.8, 0, 0.9)
		text.Draw(e.streamBuffer, flapStr, e.subMonoFace, flapOp)

		// Line 2: Network name & ASN
		netStr := fmt.Sprintf("%s (AS%d)", f.GetNetworkName(), f.GetAsn())
		if f.GetNetworkName() == fmt.Sprintf("AS%d", f.GetAsn()) {
			netStr = fmt.Sprintf("AS%d", f.GetAsn())
		}
		netOp := &text.DrawOptions{}
		netOp.ColorScale.Scale(1, 1, 1, 0.6)
		_ = e.drawWrappedText(e.streamBuffer, netStr, e.subFace, localX+15.0, currY+fontSize*1.25, boxW-30.0, fontSize*0.75, netOp)

		currY += itemH
	}
}

func (e *Engine) drawNowPlaying(screen *ebiten.Image, margin, boxW, fontSize float64, face *text.GoTextFace) {
	now := e.Now()
	if e.CurrentSong == "" {
		return
	}
	songX := float64(e.Width) - margin - (boxW * 1.0)
	songYBase := margin + fontSize + 15
	songBoxW := boxW * 1.0
	boxHSong := fontSize * 2.5
	if e.CurrentArtist != "" {
		boxHSong += fontSize * 1.2
	}
	if e.CurrentExtra != "" {
		boxHSong += fontSize * 1.2
	}

	if e.nowPlayingBuffer == nil || e.nowPlayingBuffer.Bounds().Dx() != int(songBoxW) || e.nowPlayingBuffer.Bounds().Dy() != int(boxHSong) {
		e.nowPlayingBuffer = ebiten.NewImage(int(songBoxW), int(boxHSong))
		e.nowPlayingDirty = true
	}

	if e.nowPlayingDirty {
		e.nowPlayingBuffer.Clear()

		localX, localY := 10.0, fontSize+15.0
		vector.FillRect(e.nowPlayingBuffer, 0, 0, float32(songBoxW), float32(boxHSong), color.RGBA{0, 0, 0, 100}, false)
		vector.StrokeRect(e.nowPlayingBuffer, 0, 0, float32(songBoxW), float32(boxHSong), 1, color.RGBA{36, 42, 53, 255}, false)

		songTitle := "NOW PLAYING"
		vector.FillRect(e.nowPlayingBuffer, 0, 0, 4, float32(fontSize+10), ColorNew, false)

		textOp := &text.DrawOptions{}
		textOp.GeoM.Translate(localX+5, localY-fontSize-5)
		textOp.ColorScale.Scale(1, 1, 1, 0.5)
		text.Draw(e.nowPlayingBuffer, songTitle, e.titleFace, textOp)

		yOffset := fontSize * 1.1
		e.drawMarquee(e.nowPlayingBuffer, e.CurrentSong, face, localX, localY+fontSize*0.2, 0.8, &e.songBuffer)

		if e.CurrentArtist != "" {
			e.drawMarquee(e.nowPlayingBuffer, e.CurrentArtist, e.artistFace, localX, localY+yOffset, 0.5, &e.artistBuffer)
			yOffset += fontSize * 1.1
		}

		if e.CurrentExtra != "" {
			e.drawMarquee(e.nowPlayingBuffer, e.CurrentExtra, e.extraFace, localX, localY+yOffset, 0.4, &e.extraBuffer)
		}
		e.nowPlayingDirty = false
	}

	isGlitching := now.Sub(e.songChangedAt) < 2*time.Second
	intensity := 0.0
	if isGlitching {
		intensity = 1.0 - (now.Sub(e.songChangedAt).Seconds() / 2.0)
	}

	e.drawGlitchImage(screen, e.nowPlayingBuffer, songX-10, songYBase-fontSize-15, intensity, isGlitching, 1.0)
}

func (e *Engine) drawRPKIStatus(screen *ebiten.Image, margin, boxW, fontSize float64) {
	totalV4 := e.topStatsRPKIValidIPv4 + e.topStatsRPKIInvalidIPv4 + e.topStatsRPKINotFoundIPv4
	totalV6 := e.topStatsRPKIValidIPv6 + e.topStatsRPKIInvalidIPv6 + e.topStatsRPKINotFoundIPv6
	if totalV4 == 0 && totalV6 == 0 {
		return
	}

	if e.rpkiBuffer == nil || e.rpkiBuffer.Bounds().Dx() != e.Width || e.rpkiBuffer.Bounds().Dy() != e.Height {
		e.rpkiBuffer = ebiten.NewImage(e.Width, e.Height)
		e.rpkiBuffer.Fill(color.Transparent)
		e.rpkiDirty = true
	}

	if e.rpkiDirty {
		e.rpkiBuffer.Fill(color.Transparent)

		// Bar dimensions (Horizontal)
		barW := float64(e.Width) * 0.22
		barH := 20.0
		if e.Width > 2000 {
			barW = float64(e.Width) * 0.22
			barH = 40.0
		}

		// Centering between Left Panel (Critical Stream) and Right Panel (BGP State Summary)
		streamW := boxW * 1.4
		leftPanelRight := (margin - 10) + streamW

		legendBoxW := 320.0
		if e.Width > 2000 {
			legendBoxW = 640.0
		}
		summaryW := legendBoxW * 1.5
		summaryX := float64(e.Width) - margin - summaryW

		gap := summaryX - leftPanelRight
		if gap < 0 {
			gap = 0
		}

		labelOffset := 50.0
		if e.Width > 2000 {
			labelOffset = 100.0
		}

		// Ensure bar fits comfortably within available gap with padding
		maxBarW := gap - labelOffset - 40.0
		if barW > maxBarW && maxBarW > 100 {
			barW = maxBarW
		}

		// Center the entire RPKI widget (label + bar) between both panels
		midX := (leftPanelRight + summaryX) / 2.0
		componentStartX := midX - (labelOffset+barW)/2.0
		v4X := componentStartX + labelOffset

		barY_v6 := float64(e.Height) - margin - barH
		barY_v4 := barY_v6 - barH - fontSize - 15

		drawBar := func(x float64, y float64, valid, invalid, notFound uint64, label string, isTop bool) {
			total := valid + invalid + notFound
			if total == 0 {
				return
			}

			validPct := float64(valid) / float64(total)
			invalidPct := float64(invalid) / float64(total)
			notFoundPct := float64(notFound) / float64(total)

			// Draw Background
			vector.FillRect(e.rpkiBuffer, float32(x), float32(y), float32(barW), float32(barH), color.RGBA{0, 0, 0, 180}, false)

			gap := float32(4.0)
			currX := float32(x)

			segments := []struct {
				w   float32
				col color.RGBA
			}{
				{float32(barW * validPct), ColorRPKIValid},
				{float32(barW * invalidPct), ColorRPKIInvalid},
				{float32(barW * notFoundPct), ColorRPKIUnknown},
			}

			drawRoundedRect := func(dst *ebiten.Image, rx, ry, rw, rh, rr float32, col color.RGBA, alphaMult float32) {
				if rw <= 0 || rh <= 0 {
					return
				}
				if rr > rw/2 {
					rr = rw / 2
				}
				if rr > rh/2 {
					rr = rh / 2
				}
				var path vector.Path
				path.MoveTo(rx+rr, ry)
				path.LineTo(rx+rw-rr, ry)
				path.ArcTo(rx+rw, ry, rx+rw, ry+rr, rr)
				path.LineTo(rx+rw, ry+rh-rr)
				path.ArcTo(rx+rw, ry+rh, rx+rw-rr, ry+rh, rr)
				path.LineTo(rx+rr, ry+rh)
				path.ArcTo(rx, ry+rh, rx, ry+rh-rr, rr)
				path.LineTo(rx, ry+rr)
				path.ArcTo(rx, ry, rx+rr, ry, rr)
				path.Close()

				op := &vector.DrawPathOptions{}
				op.ColorScale.ScaleWithColor(col)
				op.ColorScale.ScaleAlpha(alphaMult)
				vector.FillPath(dst, &path, nil, op)
			}

			for _, seg := range segments {
				if seg.w <= gap {
					continue
				}
				sw := seg.w - gap
				sx := currX

				// Glow Layers
				for i := 1.0; i <= 3.0; i++ {
					alpha := float32(0.3 / (i * 2.0))
					spread := float32(i * 3.0)

					op := &vector.DrawPathOptions{}
					op.Blend = ebiten.BlendLighter
					op.ColorScale.ScaleWithColor(seg.col)
					op.ColorScale.ScaleAlpha(alpha)

					var path vector.Path
					rx, ry, rw, rh, rr := sx, float32(y)-spread, sw, float32(barH)+spread*2, 4+spread
					if rr > rw/2 {
						rr = rw / 2
					}
					if rr > rh/2 {
						rr = rh / 2
					}
					path.MoveTo(rx+rr, ry)
					path.LineTo(rx+rw-rr, ry)
					path.ArcTo(rx+rw, ry, rx+rw, ry+rr, rr)
					path.LineTo(rx+rw, ry+rh-rr)
					path.ArcTo(rx+rw, ry+rh, rx+rw-rr, ry+rh, rr)
					path.LineTo(rx+rr, ry+rh)
					path.ArcTo(rx, ry+rh, rx, ry+rh-rr, rr)
					path.LineTo(rx, ry+rr)
					path.ArcTo(rx, ry, rx+rr, ry, rr)
					path.Close()
					vector.FillPath(e.rpkiBuffer, &path, nil, op)
				}

				// Base Segment
				drawRoundedRect(e.rpkiBuffer, sx, float32(y), sw, float32(barH), 4, seg.col, 0.8)

				currX += seg.w
			}
			// Percentage and Status Labels
			validTxt := fmt.Sprintf("%.0f%%", validPct*100)
			invalidTxt := fmt.Sprintf("%.0f%%", invalidPct*100)
			unknownTxt := fmt.Sprintf("%.0f%%", notFoundPct*100)

			drawValue := func(valTxt, labelTxt string, tx float64, col color.RGBA, align int) {
				op := &text.DrawOptions{}
				op.ColorScale.ScaleWithColor(col)
				op.ColorScale.Scale(1, 1, 1, float32(0.9))

				// 1. Percentage (ABOVE the bar)
				tw, _ := text.Measure(valTxt, e.subMonoFace, 0)
				finalX := tx
				switch align {
				case 1: // center
					finalX -= tw / 2
				case 2: // right
					finalX -= tw
				}
				op.GeoM.Translate(finalX, y-fontSize)
				text.Draw(e.rpkiBuffer, valTxt, e.subMonoFace, op)

				// 2. Optional Label (ABOVE the percentage, only for Top bar)
				if isTop && labelTxt != "" {
					op.GeoM.Reset()
					op.ColorScale.Scale(1, 1, 1, 0.6)
					lw, _ := text.Measure(labelTxt, e.subMonoFace, 0)
					lX := tx
					switch align {
					case 1:
						lX -= lw / 2
					case 2:
						lX -= lw
					}
					op.GeoM.Translate(lX, y-fontSize*1.9)
					text.Draw(e.rpkiBuffer, labelTxt, e.subMonoFace, op)
				}
			}

			// Valid (Left Aligned)
			drawValue(validTxt, "RPKI Valid", x, ColorRPKIValid, 0)

			// Invalid (Centered over invalid segment or its location)
			invalidCenterX := x + float64(barW*validPct) + float64(barW*invalidPct)/2
			drawValue(invalidTxt, "RPKI Invalid", invalidCenterX, ColorRPKIInvalid, 1)

			// Unknown (Right Aligned)
			drawValue(unknownTxt, "Unknown", x+barW, ColorRPKIUnknown, 2)

			// Draw Label (IPv4/IPv6)
			labelOp := &text.DrawOptions{}
			labelOp.ColorScale.ScaleWithColor(ColorRPKIUnknown)
			labelOp.ColorScale.Scale(1, 1, 1, float32(0.8))
			tw, _ := text.Measure(label, e.subMonoFace, 0)
			labelOp.GeoM.Translate(x-tw-10, y+(barH-fontSize)/2)
			text.Draw(e.rpkiBuffer, label, e.subMonoFace, labelOp)
		}

		drawBar(v4X, barY_v4, e.topStatsRPKIValidIPv4, e.topStatsRPKIInvalidIPv4, e.topStatsRPKINotFoundIPv4, "IPv4", true)
		drawBar(v4X, barY_v6, e.topStatsRPKIValidIPv6, e.topStatsRPKIInvalidIPv6, e.topStatsRPKINotFoundIPv6, "IPv6", false)

		e.rpkiDirty = false
	}

	screen.DrawImage(e.rpkiBuffer, nil)
}
func (e *Engine) drawLegendAndTrends(screen *ebiten.Image) {
	hasData := false
	for _, pc := range e.prefixCounts {
		if pc.MsgCount > 0 {
			hasData = true
			break
		}
	}
	if !hasData {
		return
	}

	margin, fontSize := 40.0, 18.0
	if e.Width > 2000 {
		margin, fontSize = 80.0, 36.0
	}

	boxW := 320.0
	if e.Width > 2000 {
		boxW = 640.0
	}

	summaryFontSize := fontSize * 0.7
	summaryW := boxW * 1.5
	summaryH := e.calculateSummaryBoxHeight(summaryFontSize)

	summaryX := float64(e.Width) - margin - summaryW
	summaryY := float64(e.Height) - margin - summaryH

	e.drawAnomalySummary(screen, summaryX, summaryY, boxW, summaryH, summaryFontSize)
}

func (e *Engine) StartMetricsLoop() {
	ticker := time.NewTicker(1 * time.Second)
	uiTicks := 0

	run := func() {
		e.metricsMu.Lock()
		defer e.metricsMu.Unlock()

		now := e.Now()
		interval := now.Sub(e.lastMetricsUpdate).Seconds()
		if interval <= 0 {
			interval = 1.0
		}
		e.lastMetricsUpdate = now

		e.updateMetricSnapshots(interval)

		uiTicks++
		targetTicks := 1
		if uiTicks >= targetTicks {
			uiTicks = 0
			e.hubUpdatedAt = now
			e.impactUpdatedAt = now
			e.impactDirty = true
		}
	}

	go func() {
		time.Sleep(2 * time.Second)
		run()
	}()

	defer ticker.Stop()
	for {
		select {
		case <-e.ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func (e *Engine) updateMetricSnapshots(interval float64) {
	snap := e.latestSnapshot

	// Shift history and add new snapshot (avoiding prepend allocations)
	if len(e.history) > 60 {
		copy(e.history, e.history[1:])
		e.history[len(e.history)-1] = snap
	} else {
		e.history = append(e.history, snap)
	}
}

func (e *Engine) drawMarquee(dst *ebiten.Image, content string, face *text.GoTextFace, x, y, alpha float64, buffer **ebiten.Image) {
	if content == "" {
		return
	}
	tw, th := text.Measure(content, face, 0)
	if *buffer == nil || (*buffer).Bounds().Dx() != int(tw+50) {
		*buffer = ebiten.NewImage(int(tw+50), int(th+10))
		(*buffer).Clear()
		textOp := &text.DrawOptions{}
		textOp.ColorScale.Scale(1, 1, 1, 1.0)
		text.Draw(*buffer, content, face, textOp)
	}

	// Draw to destination
	op := &ebiten.DrawImageOptions{}
	op.GeoM.Translate(x, y)
	op.ColorScale.Scale(1, 1, 1, float32(alpha))
	dst.DrawImage(*buffer, op)
}

func (e *Engine) drawWrappedText(dst *ebiten.Image, content string, face *text.GoTextFace, x, y, maxWidth, fontSize float64, op *text.DrawOptions) float64 {
	if content == "" {
		return y
	}

	words := strings.Fields(content)
	if len(words) == 0 {
		return y
	}

	line := words[0]
	for _, word := range words[1:] {
		testLine := line + " " + word
		tw, _ := text.Measure(testLine, face, 0)
		if tw > maxWidth {
			op.GeoM.Reset()
			op.GeoM.Translate(x, y)
			text.Draw(dst, line, face, op)
			y += fontSize * 1.1
			line = word
		} else {
			line = testLine
		}
	}

	op.GeoM.Reset()
	op.GeoM.Translate(x, y)
	text.Draw(dst, line, face, op)
	y += fontSize * 1.1

	return y
}

func (e *Engine) drawRPKILine(dst *ebiten.Image, label string, rpkiStatus int32, value string, face *text.GoTextFace, x, y, maxWidth, fontSize float64, labelColor, valueColor color.RGBA) float64 {
	op := &text.DrawOptions{}
	op.ColorScale.ScaleWithColor(labelColor)
	op.GeoM.Translate(x, y)
	text.Draw(dst, label, face, op)
	labelWidth, _ := text.Measure(label, face, 0)

	// Cyberpunk effects
	t := float64(time.Now().UnixMilli()) / 1000.0
	pulse := 0.6 + 0.4*math.Abs(math.Sin(t*3.0))

	// Draw RPKI Status
	statusText := "[UNKNOWN]"
	statusColor := ColorRPKIUnknown
	switch rpkiStatus {
	case 1:
		statusText = "[VALID]"
		statusColor = ColorRPKIValid
	case 2:
		statusText = "[INVALID]"
		statusColor = ColorRPKIInvalid
	}

	op.ColorScale.Reset()
	op.ColorScale.ScaleWithColor(statusColor)
	if rpkiStatus == 2 {
		op.ColorScale.Scale(1, 1, 1, float32(pulse))
	} else {
		op.ColorScale.Scale(1, 1, 1, 1.0)
	}

	op.GeoM.Reset()
	op.GeoM.Translate(x+labelWidth, y)
	text.Draw(dst, statusText, face, op)
	statusWidth, _ := text.Measure(statusText, face, 0)

	// Draw colon and value
	op.ColorScale.Reset()
	op.ColorScale.ScaleWithColor(labelColor)
	op.GeoM.Reset()
	op.GeoM.Translate(x+labelWidth+statusWidth, y)
	text.Draw(dst, ": ", face, op)
	colonWidth, _ := text.Measure(": ", face, 0)

	op.ColorScale.Reset()
	op.ColorScale.ScaleWithColor(valueColor)
	valX := x + labelWidth + statusWidth + colonWidth
	if value == "" {
		return y + fontSize*1.1
	}
	return e.drawWrappedText(dst, value, face, valX, y, maxWidth-(valX-x), fontSize, op)
}

func (e *Engine) drawLabeledLine(dst *ebiten.Image, label, value string, face *text.GoTextFace, x, y, maxWidth, fontSize float64, labelColor, valueColor color.RGBA) float64 {
	if label == "" && value == "" {
		return y
	}

	op := &text.DrawOptions{}
	op.ColorScale.ScaleWithColor(labelColor)
	op.GeoM.Translate(x, y)
	text.Draw(dst, label, face, op)

	labelWidth, _ := text.Measure(label, face, 0)

	op.ColorScale.Reset()
	op.ColorScale.ScaleWithColor(valueColor)

	// If value is empty, just return the next Y
	if value == "" {
		return y + fontSize*1.1
	}

	// For the first line, we have less width because of the label
	words := strings.Fields(value)
	if len(words) == 0 {
		return y + fontSize*1.1
	}

	line := words[0]
	firstLine := true
	for _, word := range words[1:] {
		testLine := line + " " + word
		currentMaxW := maxWidth
		if firstLine {
			currentMaxW = maxWidth - labelWidth
		}

		tw, _ := text.Measure(testLine, face, 0)
		if tw > currentMaxW {
			op.GeoM.Reset()
			if firstLine {
				op.GeoM.Translate(x+labelWidth, y)
				firstLine = false
			} else {
				op.GeoM.Translate(x, y)
			}
			text.Draw(dst, line, face, op)
			y += fontSize * 1.1
			line = word
		} else {
			line = testLine
		}
	}

	op.GeoM.Reset()
	if firstLine {
		op.GeoM.Translate(x+labelWidth, y)
	} else {
		op.GeoM.Translate(x, y)
	}
	text.Draw(dst, line, face, op)
	y += fontSize * 1.1

	return y
}

func (e *Engine) drawDisconnected(screen *ebiten.Image) {
	if e.IsConnected.Load() {
		return
	}

	// Blink every 2s (1000ms on, 1000ms off)
	if (time.Now().UnixMilli()/1000)%2 == 0 {
		return
	}

	msg := "DISCONNECTED"
	face := e.titleFace

	tw, th := text.Measure(msg, face, 0)
	x := (float64(e.Width) - tw) / 2
	y := (float64(e.Height) - th) / 2

	// Draw a dark background for readability
	padding := 20.0
	vector.FillRect(screen, float32(x-padding), float32(y-padding), float32(tw+padding*2), float32(th+padding*2), color.RGBA{0, 0, 0, 180}, false)
	vector.StrokeRect(screen, float32(x-padding), float32(y-padding), float32(tw+padding*2), float32(th+padding*2), 2, ColorCritical, false)

	op := &text.DrawOptions{}
	op.GeoM.Translate(x, y)
	op.ColorScale.ScaleWithColor(ColorCritical)
	text.Draw(screen, msg, face, op)
}
