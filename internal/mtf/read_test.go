package mtf_test

import (
	"bytes"
	"errors"
	"fmt"
	"math/rand/v2"
	"reflect"
	"testing"

	"klats/internal/mtf"
	"klats/internal/mtf/mtftest"
)

// emptyBody is the length of a body of zero bytes that reads as a file whose
// strings and lists are all empty.
const emptyBody = 158

// sample returns a file with one question of each type and the media table
// its pictures refer to.
func sample() (mtf.File, []mtftest.Entry) {
	f := mtf.File{
		Title:     "Дроби",
		TimeLimit: 720,
		Themes:    []mtf.Theme{{ID: 0}, {ID: 4, Ask: 2, AskOn: true}},
		Questions: []mtf.Question{
			{Type: 1, Text: mtftest.RTF("Скільки буде 1/2 + 1/4?"), Picture: "{A1}.bmp", Points: 1, Answers: []string{"3/4", "2/6"}, Keys: []uint32{1, 0}},
			{Type: 2, Text: "{\\rtf1 b}", Points: 2, Hint: mtftest.RTF("підказка"), Comment: mtftest.RTF("коментар"), ThemeID: 4, Answers: []string{"a", "b"}, Keys: []uint32{1, 1}},
			{Type: 3, Points: 3, ThemeID: 4, Answers: []string{"second", "first"}, Keys: []uint32{2, 1}},
			{Type: 4, Points: 4, Answers: []string{"L1", "L2"}, Keys: []uint32{2, 1}, Right: []string{"R1", "R2", "R3"}},
			{Type: 5, Points: 1, Answers: []string{"yes", "no"}, Keys: []uint32{1, 2}},
			{Type: 6, Points: 5, Lo: 2, Hi: 4.5},
			{Type: 7, Points: 6, Accepted: "буфер\r\nbuffer"},
			{Type: 8, Picture: "{B2}.jpg", Points: 1, Regions: [][]mtf.Point{
				{{1, 2}, {30, 2}, {30, 40}, {1, 40}},
				{{100, 100}, {200, 100}, {200, 150}, {150, 150}, {150, 200}, {100, 200}},
			}},
		},
	}
	media := []mtftest.Entry{
		{Key: "{A1}.bmp", Data: []byte("BM\x00\x01\x02")},
		{Key: "{B2}.jpg", Data: []byte("\xff\xd8\xff\xe0")},
	}
	return f, media
}

func none(string, []byte) error { return nil }

func TestReadRoundTrip(t *testing.T) {
	want, media := sample()
	var seen []mtftest.Entry
	got, err := mtf.Read(bytes.NewReader(mtftest.Encode(want, media...)), func(key string, data []byte) error {
		seen = append(seen, mtftest.Entry{Key: key, Data: data})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("read = %+v\nwant %+v", got, want)
	}
	if !reflect.DeepEqual(seen, media) {
		t.Errorf("media saw %q, want %q", seen, media)
	}
}

func TestReadRejects(t *testing.T) {
	// The fixture of the trailing-byte case is only damaged by its last byte.
	if _, err := mtf.Read(bytes.NewReader(mtftest.Envelope(make([]byte, emptyBody))), none); err != nil {
		t.Fatalf("read of an empty body = %v", err)
	}

	random := make([]byte, 4096)
	_, _ = rand.NewChaCha8([32]byte{}).Read(random)
	f, media := sample()
	full := mtftest.Encode(f, media...)

	cases := map[string][]byte{
		"random bytes":           random,
		"body cut after a title": mtftest.Envelope([]byte{1, 0, 0, 0, 'T', 0}),
		"question type 9":        mtftest.Encode(mtf.File{Questions: []mtf.Question{{Type: 9}}}),
		"string of 1<<30 units":  mtftest.Envelope([]byte{0, 0, 0, 0x40}),
		// The grade count follows five strings, the 59-byte settings block,
		// a string, 8 bytes and a string, all empty or zero.
		"list of 1<<30 grades":         mtftest.Envelope(append(make([]byte, 95), 0, 0, 0, 0x40)),
		"a byte after the media table": mtftest.Envelope(make([]byte, emptyBody+1)),
	}
	for i := range 10 {
		n := len(full) * i / 10
		cases[fmt.Sprintf("cut to %d of %d bytes", n, len(full))] = full[:n]
	}
	for name, b := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := mtf.Read(bytes.NewReader(b), none); !errors.Is(err, mtf.ErrDamaged) {
				t.Errorf("read = %v, want ErrDamaged", err)
			}
		})
	}
}

func TestReadCallbackError(t *testing.T) {
	f, media := sample()
	stop := errors.New("disk full")
	_, err := mtf.Read(bytes.NewReader(mtftest.Encode(f, media...)), func(string, []byte) error { return stop })
	if err != stop {
		t.Errorf("read = %v, want the callback's error as it is", err)
	}
}

func TestReadOldLayout(t *testing.T) {
	if _, err := mtf.Read(bytes.NewReader(mtftest.OldLayout()), none); !errors.Is(err, mtf.ErrOldLayout) {
		t.Errorf("read = %v, want ErrOldLayout", err)
	}
}

func TestSniff(t *testing.T) {
	f, _ := sample()
	file := mtftest.Encode(f)
	random := make([]byte, 64)
	_, _ = rand.NewChaCha8([32]byte{1}).Read(random)
	for name, c := range map[string]struct {
		head []byte
		want bool
	}{
		"a file":             {file[:14], true},
		"the older layout":   {mtftest.OldLayout()[:14], true},
		"a zip header":       {[]byte("PK\x03\x04\x14\x00\x00\x00\x08\x00\x00\x00\x00\x00"), false},
		"13 bytes of a file": {file[:13], false},
		"random bytes":       {random, false},
	} {
		if got := mtf.Sniff(c.head); got != c.want {
			t.Errorf("%s: Sniff = %v, want %v", name, got, c.want)
		}
	}
}

func FuzzRead(f *testing.F) {
	file, media := sample()
	full := mtftest.Encode(file, media...)
	f.Add(full)
	for i := range 10 {
		f.Add(full[:len(full)*i/10])
	}
	f.Add(make([]byte, emptyBody))
	f.Fuzz(func(t *testing.T, b []byte) {
		// A mutated file rarely gets past the cipher and zlib, so b is also
		// read as a body.
		for _, in := range [][]byte{b, mtftest.Envelope(b)} {
			_, err := mtf.Read(bytes.NewReader(in), none)
			if err != nil && !errors.Is(err, mtf.ErrDamaged) && !errors.Is(err, mtf.ErrOldLayout) {
				t.Errorf("read = %v, want nil, ErrDamaged or ErrOldLayout", err)
			}
		}
	})
}
