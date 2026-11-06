// Package mtf reads tests saved in the older format, the .mtf files of
// version 10.2 that teachers bring from the program they used before Klats.
// Klats only reads the format and never writes it.
//
// A file is one encrypted stream of a signature, a version string and a zlib
// stream holding the body: a fixed sequence of records (the test header, its
// themes, its questions and a table of picture files). The reader walks the
// body field by field as it inflates, keeping only what a converted test can
// use, and hands each picture file to a callback, so a body of a hundred
// megabytes is never held in memory. Files arrive by email or on flash drives:
// every count and length is capped before anything is allocated.
//
// The converter turns what the reader kept into a Klats test. What has no
// exact counterpart in Klats is approximated or dropped. What needs the
// teacher's attention, such as a hint or a click area that is not a
// rectangle, comes back as a note; the description, the author, the grade
// table and text styling other than bold, italic, superscript and subscript
// are dropped without one.
package mtf

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"klats/internal/media"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

var (
	// ErrDamaged is returned for a file that is not a readable test in the
	// older format.
	ErrDamaged = errors.New("mtf: damaged file")
	// ErrOldLayout is returned for a file in the format's 2008–2012 layout,
	// which Klats cannot read.
	ErrOldLayout = errors.New("mtf: older layout")
)

// Sniff reports whether head, the start of a file, decrypts to the signature
// of either layout of the older format. It is false for fewer than 14 bytes.
func Sniff(head []byte) bool {
	var plain [len(signature)]byte
	if _, err := io.ReadFull(newDecrypter(bytes.NewReader(head)), plain[:]); err != nil {
		return false
	}
	return plain == signature || bytes.HasPrefix(plain[:], oldSignature)
}

// Open reads an .mtf file, stores its pictures in ms and returns the converted
// test, already decoded by [testfmt.Decode], with an empty ID, and notes on
// what the teacher should check: test-level first, then in question order.
// Settings the file has no counterpart for keep [testfmt.DefaultSettings]. A
// picture that cannot be carried over is left out with an "image_lost" note.
// Errors wrap [ErrDamaged], or are [ErrOldLayout], or are store failures
// returned as they are. After a store failure, or an [ErrDamaged] found past
// the first picture, the pictures stored before stay in ms. A converted test
// that Decode refuses is an error of its own, a converter bug.
func Open(r io.Reader, ms *media.Store) (testfmt.Test, []wire.OpenNote, error) {
	pictures := map[string]testfmt.Image{}
	f, err := read(r, func(key string, data []byte) error {
		im, ok, err := storePicture(ms, data)
		if ok {
			pictures[key] = im
		}
		return err
	})
	if err != nil {
		return testfmt.Test{}, nil, err
	}
	t, notes, err := convert(f, ms, pictures)
	if err != nil {
		return testfmt.Test{}, nil, err
	}
	raw, err := json.Marshal(t)
	if err == nil {
		t, err = testfmt.Decode(raw)
	}
	if err != nil {
		return testfmt.Test{}, nil, fmt.Errorf("mtf: converted test is invalid: %w", err)
	}
	return t, notes, nil
}

// File is the part of a test in the older format that Klats converts.
type File struct {
	Title string
	// TimeLimit is the time limit for the whole test in seconds; 0 is none.
	TimeLimit int
	Themes    []Theme
	Questions []Question
}

// Theme is a group of questions, from which a test may ask some at random.
type Theme struct {
	ID uint32
	// Ask is how many random questions of the theme a test asks when AskOn is
	// set.
	Ask   int
	AskOn bool
}

// Question is one question of a test in the older format.
type Question struct {
	// Type is 1 single choice, 2 multiple choice, 3 ordering, 4 matching, 5
	// true or false per statement, 6 typed number, 7 typed text or 8 a place
	// to mark on a picture.
	Type int
	// Text is the wording as an RTF document, or "".
	Text string
	// Picture is the key of a media table entry, or "". On type 8 it is the
	// picture to mark; on the others an illustration shown with the question.
	Picture string
	Points  int
	// Hint and Comment are RTF documents, or "".
	Hint, Comment string
	ThemeID       uint32
	// Answers holds the used answer slots of types 1–5, the leading non-empty
	// strings, each an RTF document; on type 4 they are the left-hand items.
	Answers []string
	// Keys holds one key per answer: 1 for a correct answer on types 1 and 2,
	// the 1-based position in the correct order on type 3 (0 for an item
	// outside it), the 1-based index into Right of the partner on type 4, and
	// 1 for true or 2 for false on type 5.
	Keys []uint32
	// Right holds the used right-hand slots of type 4, which may outnumber
	// Answers.
	Right []string
	// Lo and Hi bound the accepted number of type 6.
	Lo, Hi float64
	// Accepted holds the accepted answers of type 7 as plain text, one per
	// CRLF-separated line.
	Accepted string
	// Regions holds the correct targets of type 8, each a polygon in pixels
	// of the picture, with the origin at the top left.
	Regions [][]Point
}

// Point is a polygon vertex in picture pixels.
type Point struct{ X, Y int }
