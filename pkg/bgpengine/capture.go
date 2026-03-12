// Package bgpengine provides the core logic for the BGP stream engine, including frame capture.
package bgpengine

import (
	"fmt"
	"image"
	"image/png"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/hajimehoshi/ebiten/v2"
)

func (e *Engine) InitVideoWriter() error {
	if e.VideoPath == "" {
		return nil
	}

	// Support raw output to a file if extension is .raw
	if strings.HasSuffix(strings.ToLower(e.VideoPath), ".raw") {
		f, err := os.Create(e.VideoPath)
		if err != nil {
			return err
		}
		e.VideoWriter = f
		log.Printf("Started recording raw frames to: %s", e.VideoPath)
		return nil
	}

	// Check if ffmpeg is available
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return fmt.Errorf("ffmpeg is required for video recording: %w", err)
	}

	// High-quality video recording: 3840x2160, 30fps, libx264
	// We're piping raw RGBA frames from ebiten directly into ffmpeg.
	cmd := exec.Command("ffmpeg",
		"-y",
		"-f", "rawvideo",
		"-pix_fmt", "rgba",
		"-s", fmt.Sprintf("%dx%d", e.Width, e.Height),
		"-r", "30",
		"-i", "-",
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-crf", "18",
		"-pix_fmt", "yuv420p",
		e.VideoPath,
	)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}

	// Capture stderr to log ffmpeg output if needed
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return err
	}

	e.VideoWriter = stdin
	e.VideoCmd = cmd
	log.Printf("Started recording video to: %s", e.VideoPath)
	return nil
}

func (e *Engine) captureVideoFrame(img *ebiten.Image) {
	if e.VideoWriter == nil {
		return
	}

	if e.videoBuffer == nil {
		e.videoBuffer = make([]byte, e.Width*e.Height*4)
	}

	// ebiten.Image.ReadPixels is synchronous and slow for large images,
	// but necessary for high-quality frame-accurate video capture.
	// When recording, we accept the performance hit.
	img.ReadPixels(e.videoBuffer)

	// Write raw bytes directly to ffmpeg's stdin pipe or raw file
	if _, err := e.VideoWriter.Write(e.videoBuffer); err != nil {
		log.Printf("Error writing video frame: %v", err)
		_ = e.VideoWriter.Close()
		e.VideoWriter = nil
	}
}

func (e *Engine) captureFrame(img *ebiten.Image, suffix string, timestamp time.Time) {
	if e.FrameCaptureDir == "" {
		return
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(e.FrameCaptureDir, 0o755); err != nil {
		log.Printf("Error creating capture directory: %v", err)
		return
	}

	filename := fmt.Sprintf("bgp-%s-%s.png", timestamp.Format("20060102-150405"), suffix)
	path := filepath.Join(e.FrameCaptureDir, filename)

	// Clone the image data. ebiten.Image.SubImage is not enough as it's a view.
	// We need to create a new ebiten.Image and draw the current image into it,
	// OR convert to a standard image.RGBA.
	// Actually, converting to image.RGBA is better for saving to disk in a goroutine.

	bounds := img.Bounds()
	rgba := image.NewRGBA(bounds)
	img.ReadPixels(rgba.Pix)

	go func() {
		f, err := os.Create(path)
		if err != nil {
			log.Printf("Error creating capture file: %v", err)
			return
		}
		defer func() {
			if err := f.Close(); err != nil {
				log.Printf("Error closing capture file: %v", err)
			}
		}()

		if err := png.Encode(f, rgba); err != nil {
			log.Printf("Error encoding capture: %v", err)
		}
		log.Printf("Captured frame: %s", path)
	}()
}
