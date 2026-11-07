package mtf

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"slices"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/unicode"
)

const (
	maxVersionUnits = 64
	maxStringUnits  = 8 << 20
	maxListLen      = 10_000
	maxMediaBytes   = 16 << 20
	maxBodyBytes    = 256 << 20
)

var (
	// signature is the UTF-16LE signature that starts a decrypted file.
	signature = [14]byte{0x4d, 0x00, 0x79, 0x00, 0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x58, 0x00}
	// oldSignature starts a decrypted file in the 2008–2012 layout.
	oldSignature = []byte{0x4d, 0x79, 0x54, 0x65, 0x73, 0x74}
)

// read reads the file in r, passing each media table entry to media in file
// order, and returns the rest of the test. data is a fresh slice per entry.
// read returns [ErrOldLayout] for a file in the 2008–2012 layout, the error
// media returns unchanged, and an error wrapping [ErrDamaged] for every other
// failure: a file without the signature, a broken zlib stream, a body that
// ends early, has bytes after the media table or inflates to over 256 MiB, a
// version over 64 UTF-16 code units, a string over 8,388,608 of them, a list
// over 10,000 entries, a media entry over 16 MiB, a question type outside
// 1..8 and a question whose tail is not empty. When read fails, media may
// already have seen earlier entries.
func read(r io.Reader, media func(key string, data []byte) error) (File, error) {
	d := newDecrypter(r)
	var head [len(signature)]byte
	n, err := io.ReadFull(d, head[:])
	if bytes.HasPrefix(head[:n], oldSignature) {
		return File{}, ErrOldLayout
	}
	if err != nil || head != signature {
		return File{}, damaged("no signature")
	}
	env := newWalker(d)
	env.skip(2 * env.length(maxVersionUnits))
	if env.err != nil {
		return File{}, env.err
	}
	zr, err := zlib.NewReader(env.r)
	if err != nil {
		return File{}, damaged("%v", err)
	}
	// One byte over the cap is let through, so a body over it is told apart
	// from one that ends at it.
	body := &io.LimitedReader{R: zr, N: maxBodyBytes + 1}
	w := newWalker(body)

	f := w.header()
	f.Questions = list(w, w.question)
	for range w.count() {
		key := w.str()
		data := w.bytes(w.length(maxMediaBytes))
		if w.err != nil {
			return File{}, w.err
		}
		if err := media(key, data); err != nil {
			return File{}, err
		}
	}
	if w.err != nil {
		return File{}, w.err
	}
	// Reading on to the end of the zlib stream also checks its checksum.
	switch _, err := w.r.ReadByte(); {
	case err == nil:
		return File{}, damaged("bytes after the media table")
	case err != io.EOF:
		return File{}, damaged("%v", err)
	case body.N == 0:
		return File{}, damaged("body over %d bytes", maxBodyBytes)
	}
	return f, nil
}

// decrypter undoes the format's stream cipher, whose next key byte depends on
// the plain byte before it.
type decrypter struct {
	r     io.Reader
	state uint16
}

func newDecrypter(r io.Reader) *decrypter { return &decrypter{r: r, state: 0x0101} }

func (d *decrypter) Read(p []byte) (int, error) {
	n, err := d.r.Read(p)
	for i, c := range p[:n] {
		p[i] = c ^ byte(d.state)
		d.state = uint16((uint32(p[i])+uint32(d.state))*0x6CA9 + 0xCE1C)
	}
	return n, err
}

// walker reads the fields of a body in order. Its first failure sticks: every
// later read is skipped and gives zero values, so a walk reads like the
// layout and checks w.err once at the end.
type walker struct {
	r   *bufio.Reader
	dec *encoding.Decoder
	buf [8]byte
	err error
}

func newWalker(r io.Reader) *walker {
	return &walker{r: bufio.NewReader(r), dec: unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()}
}

func (w *walker) fail(format string, args ...any) {
	if w.err == nil {
		w.err = damaged(format, args...)
	}
}

func (w *walker) readFailed(err error) {
	if err == io.EOF {
		err = io.ErrUnexpectedEOF
	}
	w.fail("%v", err)
}

// next reads n ≤ 8 bytes into w.buf.
func (w *walker) next(n int) []byte {
	b := w.buf[:n]
	if w.err == nil {
		if _, err := io.ReadFull(w.r, b); err != nil {
			w.readFailed(err)
		}
	}
	if w.err != nil {
		clear(b)
	}
	return b
}

func (w *walker) u8() byte        { return w.next(1)[0] }
func (w *walker) u32() uint32     { return binary.LittleEndian.Uint32(w.next(4)) }
func (w *walker) f64() float64    { return math.Float64frombits(binary.LittleEndian.Uint64(w.next(8))) }
func (w *walker) count() int      { return w.length(maxListLen) }
func (w *walker) region() []Point { return list(w, w.point) }
func (w *walker) point() Point    { return Point{X: int(w.u32()), Y: int(w.u32())} }

func (w *walker) skip(n int) {
	if w.err != nil {
		return
	}
	if _, err := w.r.Discard(n); err != nil {
		w.readFailed(err)
	}
}

// bytes reads n bytes into a new slice.
func (w *walker) bytes(n int) []byte {
	if w.err != nil {
		return nil
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(w.r, b); err != nil {
		w.readFailed(err)
		return nil
	}
	return b
}

// length reads a u32 count or length, failing when it is over limit.
func (w *walker) length(limit int) int {
	n := w.u32()
	if n > uint32(limit) {
		w.fail("length %d over %d", n, limit)
		return 0
	}
	return int(n)
}

// str reads a count of UTF-16 code units and the units, little-endian.
func (w *walker) str() string {
	b := w.bytes(2 * w.length(maxStringUnits))
	if len(b) == 0 {
		return ""
	}
	s, err := w.dec.Bytes(b)
	if err != nil {
		w.fail("%v", err)
		return ""
	}
	return string(s)
}

// list reads a count and that many items.
func list[T any](w *walker, item func() T) []T {
	var s []T
	for range w.count() {
		if w.err != nil {
			return nil
		}
		s = append(s, item())
	}
	return s
}

// header reads the test header, which ends where the question list starts.
func (w *walker) header() File {
	f := File{Title: w.str()}
	w.str() // author
	w.str() // e-mail
	w.str() // description
	w.str() // a second RTF document
	// The 59-byte settings block holds the time limit at offset 11.
	w.skip(11)
	f.TimeLimit = int(w.u32())
	w.skip(59 - 15)
	w.str() // hash
	w.skip(8)
	w.str() // hash
	for range w.count() {
		w.skip(8) // grade and its lowest percentage
		w.str()   // label
	}
	w.skip(1)  // a flag of unknown use
	w.skip(16) // created and modified dates
	w.str()    // GUID
	f.Themes = list(w, w.theme)
	w.skip(26) // a block of unknown use
	return f
}

func (w *walker) theme() Theme {
	t := Theme{ID: w.u32(), Name: w.str()}
	w.str() // description
	t.Ask = int(w.u32())
	t.AskOn = w.u8() != 0
	return t
}

func (w *walker) question() Question {
	q := Question{Type: int(w.u8())}
	w.skip(4) // always 5
	q.Text = w.str()
	w.skip(16) // always zero
	q.Picture = w.str()
	w.skip(4) // always zero
	q.Points = int(w.u32())
	w.skip(4) // always zero
	w.str()   // always empty
	q.Hint = w.str()
	w.skip(4) // hint penalty
	q.Comment = w.str()
	q.ThemeID = w.u32()
	w.skip(1) // always 1
	switch q.Type {
	case 1, 2, 3, 4, 5:
		q.Answers = used(list(w, w.str))
		keys := list(w, w.u32)
		if len(keys) < len(q.Answers) {
			w.fail("%d keys for %d answers", len(keys), len(q.Answers))
		} else {
			q.Keys = keys[:len(q.Answers)]
		}
		if q.Type == 4 {
			q.Right = used(list(w, w.str))
		}
	case 6:
		w.skip(1) // a mode of unknown use
		q.Lo, q.Hi = w.f64(), w.f64()
		w.skip(5) // a tail of unknown use
	case 7:
		q.Accepted = w.str()
		w.skip(2) // options of unknown use
	case 8:
		q.Regions = list(w, w.region)
	default:
		w.fail("question type %d", q.Type)
	}
	// The tail is a list whose items have never been seen, so their layout is
	// unknown.
	if n := w.u32(); n != 0 {
		w.fail("question tail of %d", n)
	}
	w.skip(1) // always zero
	return q
}

// used returns the leading slots of s that are not empty.
func used(s []string) []string {
	if i := slices.Index(s, ""); i >= 0 {
		return s[:i]
	}
	return s
}

// damaged returns an error wrapping [ErrDamaged] that gives the reason.
func damaged(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrDamaged, fmt.Sprintf(format, args...))
}
