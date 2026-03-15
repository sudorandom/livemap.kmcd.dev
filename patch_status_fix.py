import re

with open("pkg/bgpengine/status.go", "r") as f:
    content = f.read()

# We need to completely replace drawLegendAndTrends since our previous regex didn't catch everything
new_drawLegendAndTrends = """func (e *Engine) drawLegendAndTrends(screen *ebiten.Image) {
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

	spacing := 30.0
	beaconW := 220.0
	if e.Width > 2000 {
		beaconW = 440.0
	}

	totalW := summaryW + spacing + beaconW
	baseX := float64(e.Width) - margin - totalW - 120
	baseY := float64(e.Height) - margin - graphH - 10

	summaryX := baseX + 80
	gx := summaryX + summaryW + spacing
	gy := baseY - 120

	e.drawBeaconMetrics(screen, gx, gy+120, beaconW, graphH, fontSize, legendH)
	e.drawAnomalySummary(screen, summaryX, gy+120, boxW, summaryH, summaryFontSize)
}"""

content = re.sub(r'func \(e \*Engine\) drawLegendAndTrends\(screen \*ebiten\.Image\) \{.*?(?=func \(e \*Engine\) aggregateMetrics)', new_drawLegendAndTrends + "\n\n", content, flags=re.DOTALL)

with open("pkg/bgpengine/status.go", "w") as f:
    f.write(content)
