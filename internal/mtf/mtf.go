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
package mtf

import (
	"bytes"
	"errors"
	"io"
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
