// Package mtftest builds synthetic files in the older format for tests, so no
// test needs a real file, all of which hold personal data. Klats never writes
// the format: only tests import this package.
package mtftest

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"math"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"

	"klats/internal/mtf"
)

var (
	// signature is the UTF-16LE signature that starts a decrypted file.
	signature = []byte{0x4d, 0x00, 0x79, 0x00, 0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x58, 0x00}
	// oldSignature starts a decrypted file in the 2008–2012 layout.
	oldSignature = []byte{0x4d, 0x79, 0x54, 0x65, 0x73, 0x74}
)

// slots is the number of answer slots every real file stores per list.
const slots = 10

// Entry is one entry of a file's media table.
type Entry struct {
	Key  string
	Data []byte
}

// Encode returns f as a whole file with the given media table. The fields
// [mtf.File] leaves out are empty or zero, except where every school file
// holds the same value: the settings block (with f's time limit), the grade
// table, the 26-byte block starting with 1 and the constant question fields.
// Answer lists are padded with empty slots to 10, as in every real file. A
// question of a type outside 1..8 gets no type body.
func Encode(f mtf.File, media ...Entry) []byte {
	var w writer
	w.str(f.Title)
	w.str("") // author
	w.str("") // e-mail
	w.str("") // description
	w.str("") // a second RTF document
	var settings [59]byte
	for _, i := range []int{5, 6, 21, 22, 23, 24, 26, 27, 30} {
		settings[i] = 1
	}
	binary.LittleEndian.PutUint32(settings[11:], uint32(f.TimeLimit))
	w.b = append(w.b, settings[:]...)
	w.str("") // hash
	w.zeros(8)
	w.str("") // hash
	grades := []uint32{0, 17, 25, 33, 42, 50, 58, 67, 75, 83, 92}
	w.u32(uint32(len(grades)))
	for i, percent := range grades {
		w.u32(uint32(i + 1))
		w.u32(percent)
		w.str("")
	}
	w.u8(0)        // a flag of unknown use
	w.f64(45000.5) // created
	w.f64(45001.5) // modified
	w.str("{3F2504E0-4F89-11D3-9A0C-0305E82C3301}")
	w.u32(uint32(len(f.Themes)))
	for _, t := range f.Themes {
		w.u32(t.ID)
		w.str("") // name
		w.str("") // description
		w.u32(uint32(t.Ask))
		w.bool(t.AskOn)
	}
	w.u32(1) // the 26-byte block of unknown use
	w.zeros(22)
	w.u32(uint32(len(f.Questions)))
	for _, q := range f.Questions {
		w.question(q)
	}
	w.u32(uint32(len(media)))
	for _, e := range media {
		w.str(e.Key)
		w.u32(uint32(len(e.Data)))
		w.b = append(w.b, e.Data...)
	}
	return Envelope(w.b)
}

// Envelope returns body as a whole file: the signature, the version
// "10.2.0.2" and body deflated, all encrypted.
func Envelope(body []byte) []byte {
	var w writer
	w.b = append(w.b, signature...)
	w.str("10.2.0.2")
	return encrypt(append(w.b, deflate(body)...))
}

// OldLayout returns a file in the 2008–2012 layout around an empty body.
func OldLayout() []byte {
	b := append(bytes.Clone(oldSignature), 7, 0, 0, 0)
	b = append(b, "3.0.4.2"...)
	return encrypt(append(b, deflate(nil)...))
}

// RTF returns text as a minimal RTF document in one Cyrillic font (charset
// 204), the way the school files store their strings: ASCII stays as it is
// except for the escaped "{", "}" and "\", other runes become \'xx when cp1251
// holds them and \uN? per UTF-16 code unit otherwise, and "\n" becomes \par.
// Each of picts, the bytes of a WMF, is appended at the end as a \pict group.
func RTF(text string, picts ...[]byte) string {
	var b strings.Builder
	b.WriteString(`{\rtf1\ansi\ansicpg1251{\fonttbl{\f0\fnil\fcharset204 Times New Roman;}}\f0 `)
	for _, r := range text {
		c, inCP1251 := charmap.Windows1251.EncodeRune(r)
		switch {
		case r == '{' || r == '}' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r == '\n':
			b.WriteString(`\par `)
		case r < utf8.RuneSelf:
			b.WriteRune(r)
		case inCP1251:
			fmt.Fprintf(&b, `\'%02x`, c)
		default:
			for _, u := range utf16.Encode([]rune{r}) {
				fmt.Fprintf(&b, `\u%d?`, int16(u))
			}
		}
	}
	for _, p := range picts {
		fmt.Fprintf(&b, `{\pict\wmetafile8\picw1\pich1 %x}`, p)
	}
	b.WriteByte('}')
	return b.String()
}

// BMP returns a w×h 24-bit bitmap file, stored bottom-up, whose top-left pixel
// is pure red and every other pixel white.
func BMP(w, h int) []byte {
	stride := (3*w + 3) &^ 3
	var b writer
	b.b = append(b.b, "BM"...)
	b.u32(uint32(54 + stride*h))
	b.u32(0)
	b.u32(54) // the offset of the pixels
	b.u32(40) // the size of the info header
	b.u32(uint32(w))
	b.u32(uint32(h))
	b.b = binary.LittleEndian.AppendUint16(b.b, 1)  // planes
	b.b = binary.LittleEndian.AppendUint16(b.b, 24) // bits per pixel
	b.zeros(24)
	for y := h - 1; y >= 0; y-- {
		row := bytes.Repeat([]byte{0xff}, 3*w)
		if y == 0 {
			copy(row, []byte{0, 0, 0xff}) // blue, green, red
		}
		b.b = append(b.b, row...)
		b.zeros(stride - 3*w)
	}
	return b.b
}

// WMF returns a metafile whose one bitmap record, of the given function
// (0x0F43 StretchDIB or 0x0B41 DIBStretchBlt), draws bmp, a bitmap file, then
// its end record; function 0 gives a metafile holding only the end record.
// placeable puts the 22-byte placeable header first.
func WMF(bmp []byte, placeable bool, function uint16) []byte {
	var rec writer
	if function != 0 {
		params := 20
		if function == 0x0F43 {
			params = 22 // StretchDIB also has a colour usage
		}
		dib := bmp[14:]
		rec.u32(uint32((6 + params + len(dib) + 1) / 2))
		rec.b = binary.LittleEndian.AppendUint16(rec.b, function)
		rec.zeros(params)
		rec.b = append(rec.b, dib...)
		rec.zeros(len(rec.b) % 2)
	}
	rec.u32(3) // META_EOF
	rec.zeros(2)
	var w writer
	if placeable {
		w.u32(0x9AC6CDD7)
		w.zeros(18)
	}
	for _, v := range []uint16{1, 9, 0x0300} { // type, header size in words, version
		w.b = binary.LittleEndian.AppendUint16(w.b, v)
	}
	w.u32(uint32(9 + len(rec.b)/2)) // the size in words
	w.zeros(8)
	return append(w.b, rec.b...)
}

type writer struct{ b []byte }

func (w *writer) u8(v byte)     { w.b = append(w.b, v) }
func (w *writer) u32(v uint32)  { w.b = binary.LittleEndian.AppendUint32(w.b, v) }
func (w *writer) f64(v float64) { w.b = binary.LittleEndian.AppendUint64(w.b, math.Float64bits(v)) }
func (w *writer) zeros(n int)   { w.b = append(w.b, make([]byte, n)...) }

func (w *writer) bool(v bool) {
	if v {
		w.u8(1)
	} else {
		w.u8(0)
	}
}

// str writes s as a count of UTF-16 code units and the units, little-endian.
func (w *writer) str(s string) {
	units := utf16.Encode([]rune(s))
	w.u32(uint32(len(units)))
	for _, u := range units {
		w.b = binary.LittleEndian.AppendUint16(w.b, u)
	}
}

// strs writes s padded with empty strings to at least 10 slots.
func (w *writer) strs(s []string) {
	w.u32(uint32(max(slots, len(s))))
	for _, v := range s {
		w.str(v)
	}
	for range slots - len(s) {
		w.str("")
	}
}

// keys writes k padded with zeros to at least 10 slots.
func (w *writer) keys(k []uint32) {
	w.u32(uint32(max(slots, len(k))))
	for _, v := range k {
		w.u32(v)
	}
	for range slots - len(k) {
		w.u32(0)
	}
}

func (w *writer) question(q mtf.Question) {
	w.u8(byte(q.Type))
	w.u32(5)
	w.str(q.Text)
	w.zeros(16)
	w.str(q.Picture)
	w.zeros(4)
	w.u32(uint32(q.Points))
	w.u32(0)
	w.str("")
	w.str(q.Hint)
	w.u32(0) // hint penalty
	w.str(q.Comment)
	w.u32(q.ThemeID)
	w.u8(1)
	switch q.Type {
	case 1, 2, 3, 4, 5:
		w.strs(q.Answers)
		w.keys(q.Keys)
		if q.Type == 4 {
			w.strs(q.Right)
		}
	case 6:
		w.u8(1)
		w.f64(q.Lo)
		w.f64(q.Hi)
		w.b = append(w.b, 0, 0, 0, 0, 1)
	case 7:
		w.str(q.Accepted)
		w.zeros(2)
	case 8:
		w.u32(uint32(len(q.Regions)))
		for _, r := range q.Regions {
			w.u32(uint32(len(r)))
			for _, p := range r {
				w.u32(uint32(p.X))
				w.u32(uint32(p.Y))
			}
		}
	}
	w.u32(0)
	w.u8(0)
}

func deflate(b []byte) []byte {
	var buf bytes.Buffer
	zw, _ := zlib.NewWriterLevel(&buf, zlib.BestCompression)
	_, _ = zw.Write(b)
	_ = zw.Close()
	return buf.Bytes()
}

// encrypt applies the format's stream cipher, whose next key byte depends on
// the plain byte before it.
func encrypt(plain []byte) []byte {
	out := make([]byte, len(plain))
	state := uint16(0x0101)
	for i, p := range plain {
		out[i] = p ^ byte(state)
		state = uint16((uint32(p)+uint32(state))*0x6CA9 + 0xCE1C)
	}
	return out
}
