package demo

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
)

const (
	diagramW = 640
	diagramH = 360
)

// diagram returns a PNG of a red rectangle, a blue square and a green circle
// on a cream background.
func diagram() ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, diagramW, diagramH))
	fill := func(r image.Rectangle, c color.Color) {
		draw.Draw(img, r, image.NewUniform(c), image.Point{}, draw.Src)
	}
	fill(img.Bounds(), color.RGBA{0xf4, 0xf1, 0xea, 0xff})
	fill(image.Rect(50, 90, 230, 270), color.RGBA{0xe0, 0x48, 0x48, 0xff})
	fill(image.Rect(260, 110, 420, 250), color.RGBA{0x2f, 0x6f, 0xd6, 0xff})
	green := color.RGBA{0x2a, 0xa1, 0x6a, 0xff}
	const cx, cy, r = 530, 180, 80
	for y := cy - r; y <= cy+r; y++ {
		for x := cx - r; x <= cx+r; x++ {
			if (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r {
				img.Set(x, y, green)
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// tone returns a WAV file of a quiet 440 Hz sine, 1.5 s of 16-bit mono PCM at
// 8 kHz.
func tone() []byte {
	const rate, n = 8000, 12000
	var buf bytes.Buffer
	le := func(v any) { _ = binary.Write(&buf, binary.LittleEndian, v) }
	buf.WriteString("RIFF")
	le(uint32(36 + 2*n))
	buf.WriteString("WAVEfmt ")
	le(uint32(16))
	le(uint16(1)) // PCM
	le(uint16(1)) // mono
	le(uint32(rate))
	le(uint32(rate * 2))
	le(uint16(2))
	le(uint16(16))
	buf.WriteString("data")
	le(uint32(2 * n))
	for i := range n {
		le(int16(3000 * math.Sin(2*math.Pi*440*float64(i)/rate)))
	}
	return buf.Bytes()
}
