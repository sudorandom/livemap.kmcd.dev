// Package geoservice provides geographic projection services.
package geoservice

import (
	"math"
	"sync"
)

type CityInfo struct {
	Lat, Lng   float32
	Population uint64
}

type GeoService struct {
	width, height int
	scale         float64
	dataMu        sync.RWMutex
	cities        []CityInfo
}

func NewGeoService(width, height int, scale float64) *GeoService {
	return &GeoService{
		width:  width,
		height: height,
		scale:  scale,
	}
}

func (g *GeoService) GetCities() []CityInfo {
	g.dataMu.RLock()
	defer g.dataMu.RUnlock()
	return g.cities
}

func (g *GeoService) Project(lat, lng float64) (x, y float64) {
	if lat > 89.5 {
		lat = 89.5
	}
	if lat < -89.5 {
		lat = -89.5
	}

	latRad, lngRad := lat*math.Pi/180, lng*math.Pi/180
	theta := latRad
	for i := 0; i < 10; i++ {
		denom := 2 + 2*math.Cos(2*theta)
		if math.Abs(denom) < 1e-9 {
			break
		}
		delta := (2*theta + math.Sin(2*theta) - math.Pi*math.Sin(latRad)) / denom
		theta -= delta
		if math.Abs(delta) < 1e-7 {
			break
		}
	}
	r := g.scale
	x = (float64(g.width) / 2) + r*(2*math.Sqrt(2)/math.Pi)*lngRad*math.Cos(theta)
	y = (float64(g.height) / 2) - r*math.Sqrt(2)*math.Sin(theta)
	return x, y
}
