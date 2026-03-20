package bgpengine

import (
	"image"
	"image/color"
	"math"
	"strings"
	"time"

	"github.com/hajimehoshi/ebiten/v2"
	"github.com/hajimehoshi/ebiten/v2/text/v2"
	"github.com/hajimehoshi/ebiten/v2/vector"
	"github.com/sudorandom/bgp-stream/pkg/bgp"
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

	// 1. Left Column: Critical Event Stream
	// Positioned starting halfway down the map
	streamY := float64(e.Height) * 0.50
	if e.Width > 2000 {
		streamY = float64(e.Height) * 0.50
	}

	e.streamMu.Lock()
	if len(e.CriticalStream) > 0 {
		// Extend to near the bottom of the view
		maxStreamH := float64(e.Height) - margin - streamY
		streamH := e.calculateStreamBoxHeight(fontSize, maxStreamH)
		e.drawCriticalStream(screen, margin-10, streamY, boxW*1.4, streamH, fontSize)
	}
	e.streamMu.Unlock()

	e.metricsMu.Lock()
	defer e.metricsMu.Unlock()

	// 3. Bottom Center: Now Playing
	e.drawNowPlaying(screen, margin, boxW, fontSize, e.face)

	// 4. Bottom Right: Legend, Anomaly Summary & Trendlines
	e.drawLegendAndTrends(screen)

	// 5. Left Bottom / Above Now Playing: Flappiest Network
	e.drawFlappiestNetwork(screen, margin, boxW, fontSize)

	// 6. RPKI Status Vertical Progress Bar
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
	op.GeoM.Translate(xBase-10, yBase-fontSize-15)
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

func (e *Engine) calculateStreamBoxHeight(fontSize, maxHeight float64) float64 {
	// Always return the full available height to extend to the bottom
	return maxHeight
}

func (e *Engine) drawCriticalStream(screen *ebiten.Image, margin, yBase, boxW, boxH, fontSize float64) {
	if e.streamBuffer == nil || e.streamBuffer.Bounds().Dx() != int(boxW*1.1) || e.streamBuffer.Bounds().Dy() != int(boxH) {
		e.streamBuffer = ebiten.NewImage(int(boxW*1.1), int(boxH))
		e.streamClipBuffer = ebiten.NewImage(int(boxW*1.1), int(boxH))
		e.streamDirty = true
	}

	if e.streamDirty {
		e.streamBuffer.Clear()

		boxW *= 1.1
		localX, localY := 10.0, fontSize+15.0
		vector.FillRect(e.streamBuffer, 0, 0, float32(boxW), float32(boxH), color.RGBA{0, 0, 0, 100}, false)
		vector.StrokeRect(e.streamBuffer, 0, 0, float32(boxW), float32(boxH), 1, color.RGBA{36, 42, 53, 255}, false)

		streamTitle := "MAJOR ANOMALY STREAM"
		vector.FillRect(e.streamBuffer, 0, 0, 4, float32(fontSize+10), color.RGBA{255, 50, 50, 255}, false)

		textOp := &text.DrawOptions{}
		textOp.GeoM.Translate(localX+5, localY-fontSize-5)
		textOp.ColorScale.Scale(1, 1, 1, 0.5)
		text.Draw(e.streamBuffer, streamTitle, e.titleFace, textOp)

		if len(e.CriticalStream) == 0 {
			textOp.GeoM.Reset()
			textOp.GeoM.Translate(localX+5, localY+5)
			textOp.ColorScale.Reset()
			textOp.ColorScale.Scale(1, 1, 1, 0.3)
			text.Draw(e.streamBuffer, "Waiting for major anomalies...", e.subMonoFace, textOp)
		} else {
			e.streamClipBuffer.Clear()
			currentY := e.streamOffset

			// Use all events for display
			displayStream := e.CriticalStream

			for i, ce := range displayStream {
				nextY := e.drawCriticalEvent(ce, localX, currentY, boxW, fontSize)

				// Draw a subtle separator if not the last one
				if i < len(displayStream)-1 && nextY+12 < boxH {
					vector.StrokeLine(e.streamClipBuffer, float32(localX+10), float32(nextY+10), float32(boxW-10), float32(nextY+10), 2, color.RGBA{255, 255, 255, 30}, false)
				}

				currentY = nextY + 25.0 // Increased spacer
				if currentY > boxH+100 {
					break
				}
			}

			// Draw clipped events onto stream buffer below title area
			op := &ebiten.DrawImageOptions{}
			op.GeoM.Translate(0, localY+5)
			// Create a sub-image for the events area to ensure clipping
			e.streamBuffer.DrawImage(e.streamClipBuffer.SubImage(image.Rect(0, 0, int(boxW), int(boxH-localY-5))).(*ebiten.Image), op)
		}
		e.streamDirty = false
	}

	now := e.Now()
	isGlitching := now.Sub(e.streamUpdatedAt) < 300*time.Millisecond
	intensity := 0.0
	if isGlitching {
		intensity = 1.0 - (now.Sub(e.streamUpdatedAt).Seconds() / 0.3)
	}

	e.drawGlitchImage(screen, e.streamBuffer, margin-10, yBase-fontSize-15, intensity, isGlitching)
}

func (e *Engine) drawCriticalEvent(ce *CriticalEvent, x, y, boxW, fontSize float64) float64 {
	indent := 20.0
	rightEdge := boxW - 15.0
	// We are now drawing into streamClipBuffer which represents only the events area
	textOp := &text.DrawOptions{}
	// Draw Anomaly Type Label (e.g. [OUTAGE])

	if ce.CachedTypeWidth == 0 && e.subMonoFace != nil {
		ce.CachedTypeWidth, _ = text.Measure(ce.CachedTypeLabel, e.subMonoFace, 0)
	}

	cr, cg, cb := float32(ce.UIColor.R)/255.0, float32(ce.UIColor.G)/255.0, float32(ce.UIColor.B)/255.0

	title := ce.CachedTypeLabel
	if ce.Resolved {
		title = "[RESOLVED]" + title
	}

	textOp.GeoM.Translate(x, y)
	if ce.Resolved {
		textOp.ColorScale.Scale(0, 1, 0, 0.9)
	} else {
		textOp.ColorScale.Scale(cr, cg, cb, 0.9)
	}

	// Draw the Title (wrapped)
	nextY := e.drawWrappedText(e.streamClipBuffer, title, e.subMonoFace, x, y, rightEdge-x, fontSize, textOp)
	if nextY == y {
		nextY = y + fontSize*1.1
	}

	// Draw metrics (e.g. "% increase...") below title, also wrapped
	if ce.CachedFirstLine != "" {
		textOp.ColorScale.Reset()
		if (ce.Anom == bgp.NameRouteLeak || ce.Anom == bgp.NameMinorRouteLeak) || ce.Anom == bgp.NameHardOutage || ce.Anom == bgp.NameDDoSMitigation || ce.Anom == bgp.NameHijack {
			if ce.Resolved {
				textOp.ColorScale.Scale(0, 1, 0, 0.9)
			} else {
				textOp.ColorScale.Scale(0, 1, 1, 0.9) // Cyan
			}
		} else {
			textOp.ColorScale.Scale(cr, cg, cb, 0.7)
		}
		nextY = e.drawWrappedText(e.streamClipBuffer, ce.CachedFirstLine, e.subMonoFace, x, nextY, rightEdge-x, fontSize, textOp)
	}

	labelCol := color.RGBA{180, 180, 180, 255} // Light gray
	valueCol := color.RGBA{255, 255, 0, 255}   // Bright yellow

	// Details for Route Leaks
	switch {
	case (ce.Anom == bgp.NameRouteLeak || ce.Anom == bgp.NameMinorRouteLeak || strings.Contains(strings.ToLower(ce.Anom), "route leak")) && !ce.IsAggregate:
		if ce.LeakType != bgp.LeakUnknown {
			// Leaker
			nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedLeakerLabel, ce.LeakerRPKI, ce.CachedLeakerVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)

			// Impacted
			nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedVictimLabel, ce.VictimRPKI, ce.CachedVictimVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)

			// Networks line
			nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
		}
	case (ce.Anom == bgp.NameHardOutage || strings.Contains(strings.ToLower(ce.Anom), "outage")) && !ce.IsAggregate:
		// ASN line
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedASNLabel, ce.CachedASNVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)

		// Networks line
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
	case (ce.Anom == bgp.NameDDoSMitigation || ce.Anom == bgp.NameHijack || strings.Contains(strings.ToLower(ce.Anom), "hijack") || strings.Contains(strings.ToLower(ce.Anom), "ddos")) && !ce.IsAggregate:
		// Attacker / Source
		nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedLeakerLabel, ce.LeakerRPKI, ce.CachedLeakerVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)

		// Victim / Target
		nextY = e.drawRPKILine(e.streamClipBuffer, ce.CachedVictimLabel, ce.VictimRPKI, ce.CachedVictimVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)

		// Networks line
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, x+indent, nextY, rightEdge-(x+indent), fontSize, labelCol, valueCol)
	}

	if ce.CachedLocVal != "" {
		curIndent := indent
		if ce.CachedLocLabel == "" {
			curIndent = 0
		}
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedLocLabel, ce.CachedLocVal, e.subMonoFace, x+curIndent, nextY, rightEdge-(x+curIndent), fontSize, labelCol, valueCol)
	} else if ce.Locations != "" {
		curIndent := indent
		if ce.CachedLocLabel == "" {
			curIndent = 0
		}
		nextY = e.drawLabeledLine(e.streamClipBuffer, ce.CachedLocLabel, ce.Locations, e.subMonoFace, x+curIndent, nextY, rightEdge-(x+curIndent), fontSize, labelCol, valueCol)
	}

	return nextY
}

const indent = 20.0

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

	e.drawGlitchImage(screen, e.nowPlayingBuffer, songX-10, songYBase-fontSize-15, intensity, isGlitching)
}

func (e *Engine) drawFlappiestNetwork(screen *ebiten.Image, margin, boxW, fontSize float64) {
	if e.topStatsFlappiestASN == "" {
		return
	}

	panelW := boxW * 1.0
	panelH := fontSize * 2.5 + fontSize*1.2

	// Calculate Now Playing height to position below it
	boxHSong := fontSize * 2.5
	if e.CurrentArtist != "" {
		boxHSong += fontSize * 1.2
	}
	if e.CurrentExtra != "" {
		boxHSong += fontSize * 1.2
	}

	panelX := float64(e.Width) - margin - (boxW * 1.0)
	panelY := margin + boxHSong + 20 // Below Now Playing

	localX, localY := 10.0, fontSize+15.0

	// Draw Background
	vector.FillRect(screen, float32(panelX-10), float32(panelY), float32(panelW), float32(panelH), color.RGBA{0, 0, 0, 100}, false)
	vector.StrokeRect(screen, float32(panelX-10), float32(panelY), float32(panelW), float32(panelH), 1, color.RGBA{36, 42, 53, 255}, false)
	vector.FillRect(screen, float32(panelX-10), float32(panelY), 4, float32(fontSize+10), ColorBad, false)

	// Draw Title
	textOp := &text.DrawOptions{}
	textOp.GeoM.Translate(panelX-10+localX+5, panelY+localY-fontSize-5)
	textOp.ColorScale.Scale(1, 1, 1, 0.5)
	text.Draw(screen, "FLAPPIEST NETWORK", e.titleFace, textOp)

	// Draw Content
	asnOp := &text.DrawOptions{}
	asnOp.GeoM.Translate(panelX-10+localX, panelY+localY+fontSize*0.2)
	asnOp.ColorScale.Scale(1, 1, 1, 0.8)
	text.Draw(screen, e.topStatsFlappiestPrefix + " (" + e.topStatsFlappiestASN + ")", e.face, asnOp)

	orgOp := &text.DrawOptions{}
	orgOp.GeoM.Translate(panelX-10+localX, panelY+localY+fontSize*1.3)
	orgOp.ColorScale.Scale(1, 1, 1, 0.5)
	text.Draw(screen, e.topStatsFlappiestOrg, e.artistFace, orgOp)
}

func (e *Engine) drawRPKIStatus(screen *ebiten.Image, margin, boxW, fontSize float64) {
	total := e.topStatsRPKIValidIPv4 + e.topStatsRPKIInvalidIPv4 + e.topStatsRPKINotFoundIPv4
	if total == 0 {
		return
	}

	validPct := float64(e.topStatsRPKIValidIPv4) / float64(total)
	invalidPct := float64(e.topStatsRPKIInvalidIPv4) / float64(total)
	notFoundPct := float64(e.topStatsRPKINotFoundIPv4) / float64(total)

	// Position the vertical bar to the right edge
	barW := 15.0
	barH := float64(e.Height) * 0.4 // 40% of screen height
	if e.Width > 2000 {
		barW = 30.0
	}

	// Just above the summary/trendlines box
	barX := float64(e.Width) - margin - barW
	barY := float64(e.Height) - margin - 350 - barH - 20
	if e.Width > 2000 {
		barY = float64(e.Height) - margin - 700 - barH - 20
	}

	// Draw Background for the bar
	vector.FillRect(screen, float32(barX), float32(barY), float32(barW), float32(barH), color.RGBA{0, 0, 0, 100}, false)
	vector.StrokeRect(screen, float32(barX), float32(barY), float32(barW), float32(barH), 1, color.RGBA{36, 42, 53, 255}, false)

	currY := float32(barY)

	validH := float32(barH * validPct)
	invalidH := float32(barH * invalidPct)
	notFoundH := float32(barH * notFoundPct)

	// Not Found (Grey)
	if notFoundH > 0 {
		vector.FillRect(screen, float32(barX), currY, float32(barW), notFoundH, color.RGBA{120, 120, 120, 200}, false)
		currY += notFoundH
	}
	// Invalid (Red)
	if invalidH > 0 {
		vector.FillRect(screen, float32(barX), currY, float32(barW), invalidH, color.RGBA{220, 50, 50, 200}, false)
		currY += invalidH
	}
	// Valid (Green)
	if validH > 0 {
		vector.FillRect(screen, float32(barX), currY, float32(barW), validH, color.RGBA{50, 220, 50, 200}, false)
	}

	// Add RPKI label below the bar
	msg := "RPKI"
	tw, _ := text.Measure(msg, e.subMonoFace, 0)

	labelOp := &text.DrawOptions{}
	labelOp.ColorScale.Scale(1, 1, 1, 0.8)
	labelOp.GeoM.Translate(barX + (barW - tw)/2, barY + barH + 5)
	text.Draw(screen, msg, e.subMonoFace, labelOp)
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
	legendH := 150.0
	if e.Width > 2000 {
		legendH = 300.0
		boxW = 640.0
	}

	summaryFontSize := fontSize * 0.7
	summaryW := boxW * 1.5
	summaryH := e.calculateSummaryBoxHeight(summaryFontSize)

	trendBoxH := legendH - fontSize - 25
	graphH := trendBoxH - 10

	summaryX := float64(e.Width) - margin - summaryW - 40
	gy := float64(e.Height) - margin - graphH - 10 - 120

	e.drawAnomalySummary(screen, summaryX, gy+120, boxW, summaryH, summaryFontSize)
}

func (e *Engine) aggregateMetrics(s *MetricSnapshot) (good, poly, bad, crit float64) {
	// Normal (Blue) - Includes Discovery and None
	good = s.Global
	// Policy (Purple)
	poly = s.Hunting + s.Oscill + s.DDoS

	// Bad (Orange)
	bad = s.Flap
	// Critical (Red)
	crit = s.Outage + s.Leak + s.Hijack + s.Bogon
	return
}

func (e *Engine) logVal(v float64) float64 {
	if v < 1 {
		return 0
	}
	return math.Log10(v)
}

func (e *Engine) calculateGlobalIPBounds() (minLog, maxLog float64) {
	globalMaxLog := 1.0
	globalMinLog := 100.0
	if len(e.history) < 3 {
		return 0, 1.0
	}
	hasData := false
	for i := 2; i < len(e.history); i++ {
		s := &e.history[i]
		for _, v := range []uint64{s.GoodIPs, s.PolyIPs, s.BadIPs, s.CritIPs} {
			if v > 0 {
				l := e.logVal(float64(v))
				if l > globalMaxLog {
					globalMaxLog = l
				}
				if l < globalMinLog {
					globalMinLog = l
				}
				hasData = true
			}
		}
	}
	if !hasData {
		return 0, 1.0
	}
	// Round down min to previous power of 10
	globalMinLog = math.Floor(globalMinLog)
	if globalMinLog < 0 {
		globalMinLog = 0
	}
	// Round up max to next power of 10 to always show one additional label
	globalMaxLog = math.Floor(globalMaxLog) + 1.0

	if globalMaxLog <= globalMinLog {
		globalMaxLog = globalMinLog + 1.0
	}
	return globalMinLog, globalMaxLog
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

	for range ticker.C {
		run()
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

	// Draw RPKI Status
	statusText := "[NO RPKI]"
	statusColor := color.RGBA{255, 50, 50, 255} // Red
	if rpkiStatus == 1 {
		statusText = "[RPKI]"
		statusColor = color.RGBA{0, 255, 0, 255} // Green
	}

	op.ColorScale.Reset()
	op.ColorScale.ScaleWithColor(statusColor)
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

func (e *Engine) wrapHeight(content string, face *text.GoTextFace, maxWidth, fontSize float64) float64 {
	if content == "" {
		return 0
	}
	if face == nil {
		return fontSize * 1.1
	}
	words := strings.Fields(content)
	if len(words) == 0 {
		return 0
	}
	h := fontSize * 1.1
	line := words[0]
	for _, word := range words[1:] {
		testLine := line + " " + word
		tw, _ := text.Measure(testLine, face, 0)
		if tw > maxWidth {
			h += fontSize * 1.1
			line = word
		} else {
			line = testLine
		}
	}
	return h
}

func (e *Engine) labeledLineHeight(label, value string, face *text.GoTextFace, maxWidth, fontSize float64) float64 {
	if label == "" && value == "" {
		return 0
	}
	if face == nil {
		return fontSize * 1.1
	}
	labelWidth, _ := text.Measure(label, face, 0)
	h := fontSize * 1.1
	words := strings.Fields(value)
	if len(words) == 0 {
		return h
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
			h += fontSize * 1.1
			line = word
			firstLine = false
		} else {
			line = testLine
		}
	}
	return h
}

func (e *Engine) calculateEventHeight(ce *CriticalEvent, boxW, fontSize float64) float64 {
	x := 10.0 // Consistent with localX in drawCriticalStream
	rightEdge := boxW - 15.0
	title := ce.CachedTypeLabel
	if ce.Resolved {
		title = "[RESOLVED]" + title
	}
	h := e.wrapHeight(title, e.subMonoFace, rightEdge-x, fontSize)

	if ce.CachedFirstLine != "" {
		h += e.wrapHeight(ce.CachedFirstLine, e.subMonoFace, rightEdge-x, fontSize)
	}

	indent := 20.0
	detailsRightEdge := rightEdge

	switch ce.Anom {
	case bgp.NameRouteLeak, bgp.NameMinorRouteLeak:
		if ce.LeakType != bgp.LeakUnknown {
			// Leaker line height (Label + [RPKI]: + Value)
			leakerLabelWithStatus := ce.CachedLeakerLabel + "[NO RPKI]: "
			h += e.labeledLineHeight(leakerLabelWithStatus, ce.CachedLeakerVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)

			// Impacted line height
			impactedLabelWithStatus := ce.CachedVictimLabel + "[NO RPKI]: "
			h += e.labeledLineHeight(impactedLabelWithStatus, ce.CachedVictimVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)

			h += e.labeledLineHeight(ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)
		}
	case bgp.NameHardOutage:
		h += e.labeledLineHeight(ce.CachedASNLabel, ce.CachedASNVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)
		h += e.labeledLineHeight(ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)
	case bgp.NameDDoSMitigation, bgp.NameHijack:
		// Attacker/Source line height
		attackerLabelWithStatus := ce.CachedLeakerLabel + "[NO RPKI]: "
		h += e.labeledLineHeight(attackerLabelWithStatus, ce.CachedLeakerVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)

		// Victim/Target line height
		victimLabelWithStatus := ce.CachedVictimLabel + "[NO RPKI]: "
		h += e.labeledLineHeight(victimLabelWithStatus, ce.CachedVictimVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)

		h += e.labeledLineHeight(ce.CachedNetLabel, ce.CachedNetVal, e.subMonoFace, detailsRightEdge-(x+indent), fontSize)
	}

	if ce.CachedLocVal != "" {
		curIndent := indent
		if ce.CachedLocLabel == "" {
			curIndent = 0
		}
		h += e.labeledLineHeight(ce.CachedLocLabel, ce.CachedLocVal, e.subMonoFace, detailsRightEdge-(x+curIndent), fontSize)
	} else if ce.Locations != "" {
		curIndent := indent
		if ce.CachedLocLabel == "" {
			curIndent = 0
		}
		h += e.labeledLineHeight(ce.CachedLocLabel, ce.Locations, e.subMonoFace, detailsRightEdge-(x+curIndent), fontSize)
	}

	return h
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
	if e.Width > 2000 {
		// Use a larger font for high-res if available, otherwise titleFace is already scaled
	}

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
