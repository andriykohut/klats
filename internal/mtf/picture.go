package mtf

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"

	"golang.org/x/image/bmp"

	"klats/internal/media"
	"klats/internal/testfmt"
)

// maxSide is the longest side testfmt accepts for an image.
const maxSide = 10000

// storePicture stores data, a JPEG, PNG, GIF or BMP file, in ms and returns it
// as an image of a test. A BMP is stored as PNG, since the store refuses BMP.
// ok is false when data is no picture it can read, the store refuses it
// ([media.ErrUnsupported], [media.ErrTooLarge]) or a side exceeds 10000; err
// is any other store failure, which stops the import.
func storePicture(ms *media.Store, data []byte) (img testfmt.Image, ok bool, err error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > maxSide || cfg.Height > maxSide {
		return testfmt.Image{}, false, nil
	}
	if format == "bmp" {
		// bmp.Decode makes room for every pixel before it reads a row, so a
		// header claiming more pixels than data can hold, at 1 bit each with a
		// palette and 24 without, is refused first.
		bits := 24
		if _, paletted := cfg.ColorModel.(color.Palette); paletted {
			bits = 1
		}
		if cfg.Width*cfg.Height*bits > 8*len(data) {
			return testfmt.Image{}, false, nil
		}
		m, err := bmp.Decode(bytes.NewReader(data))
		if err != nil {
			return testfmt.Image{}, false, nil
		}
		var b bytes.Buffer
		if err := png.Encode(&b, m); err != nil {
			return testfmt.Image{}, false, nil
		}
		data = b.Bytes()
	}
	src, err := ms.Put(bytes.NewReader(data))
	if errors.Is(err, media.ErrUnsupported) || errors.Is(err, media.ErrTooLarge) {
		return testfmt.Image{}, false, nil
	}
	if err != nil {
		return testfmt.Image{}, false, err
	}
	return testfmt.Image{Src: src, W: cfg.Width, H: cfg.Height}, true, nil
}

// pictPicture stores p, a picture from RTF text, as [storePicture] does: a WMF
// as the first bitmap it draws, which becomes a PNG, and a JPEG or PNG as it
// is. ok is false for any other kind and for a WMF drawing no bitmap it can
// read.
func pictPicture(ms *media.Store, p pict) (testfmt.Image, bool, error) {
	switch p.Kind {
	case "wmetafile":
		if f := wmfBitmap(p.Data); f != nil {
			return storePicture(ms, f)
		}
	case "jpegblip", "pngblip":
		return storePicture(ms, p.Data)
	}
	return testfmt.Image{}, false, nil
}

// wmfBitmap returns, as a BMP file, the first bitmap that wmf, a Windows
// metafile, draws with a StretchDIB or DIBStretchBlt record, or nil when the
// records up to the end record, or up to one running past the data, draw none.
func wmfBitmap(wmf []byte) []byte {
	b := wmf
	if len(b) >= 22 && binary.LittleEndian.Uint32(b) == 0x9AC6CDD7 {
		b = b[22:] // the placeable header
	}
	if len(b) < 4 {
		return nil
	}
	header := 2 * int(binary.LittleEndian.Uint16(b[2:]))
	if header > len(b) {
		return nil
	}
	b = b[header:]
	for len(b) >= 6 {
		size := 2 * uint64(binary.LittleEndian.Uint32(b))
		function := binary.LittleEndian.Uint16(b[4:])
		if function == 0 || size < 6 || size > uint64(len(b)) {
			return nil
		}
		params := b[6:size]
		b = b[size:]
		var at int
		switch function {
		case 0x0F43: // StretchDIB: rop u32, usage u16, 8×u16
			at = 22
		case 0x0B41: // DIBStretchBlt: rop u32, 8×u16
			at = 20
		default:
			continue
		}
		if len(params) >= at {
			if f := bmpFile(params[at:]); f != nil {
				return f
			}
		}
	}
	return nil
}

// bmpFile returns dib, a bitmap without the file header, as a metafile holds
// it, as a BMP file, or nil when dib is too short for its info header and
// colour table.
func bmpFile(dib []byte) []byte {
	if len(dib) < 40 {
		return nil
	}
	info := uint64(binary.LittleEndian.Uint32(dib))
	bits := binary.LittleEndian.Uint16(dib[14:])
	colours := uint64(binary.LittleEndian.Uint32(dib[32:]))
	if colours == 0 && bits <= 8 {
		colours = 1 << bits
	}
	offset := 14 + info + 4*colours
	if offset > uint64(14+len(dib)) {
		return nil
	}
	f := make([]byte, 14, 14+len(dib))
	copy(f, "BM")
	binary.LittleEndian.PutUint32(f[2:], uint32(len(f)+len(dib)))
	binary.LittleEndian.PutUint32(f[10:], uint32(offset))
	return append(f, dib...)
}
