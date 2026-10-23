// Package testfmt defines the test document a teacher builds and the
// validation checks shared by the builder and the start-of-test gate.
package testfmt

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"klats/internal/rich"
)

// Test is a teacher-authored test. Rich-text fields hold canonical rich.Doc JSON.
type Test struct {
	ID        string     `json:"id"`
	Version   int        `json:"version"`
	Title     string     `json:"title"`
	Palette   string     `json:"palette"`
	Questions []Question `json:"questions"`
}

type Question struct {
	ID             string          `json:"id"`
	Type           string          `json:"type"` // "single" or "multi"
	Text           json.RawMessage `json:"text"`
	Points         int             `json:"points"`
	ShuffleOptions bool            `json:"shuffleOptions"`
	Partial        bool            `json:"partial"`
	Options        []Option        `json:"options"`
}

type Option struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
	Correct bool            `json:"correct"`
	Image   *Image          `json:"image,omitempty"`
}

// Image is a picture shown with an option: a media name and its size in pixels.
type Image struct {
	Src string `json:"src"`
	W   int    `json:"w"`
	H   int    `json:"h"`
}

const (
	DefaultPalette = "teal"
	minPoints      = 1
	maxPoints      = 12
	maxImageSide   = 10000
)

var palettes = []string{DefaultPalette, "grape", "coral", "lavender", "classic"}

// ErrTooNew is returned by [Decode] for a test whose version is above 1, the
// only format this program reads: a newer program made it.
var ErrTooNew = errors.New("testfmt: test made by a newer version")

// Decode parses and validates a test document, returning [ErrTooNew] for a
// version above 1. An empty palette becomes DefaultPalette. Every rich-text
// field is replaced by the canonical JSON of its parsed rich.Doc (a missing or
// null field becomes an empty document), so callers persist the result rather
// than the input. Content problems such as a missing correct option are not
// errors here; see Test.Problems.
func Decode(raw []byte) (Test, error) {
	var t Test
	if err := json.Unmarshal(raw, &t); err != nil {
		return Test{}, fmt.Errorf("testfmt: %w", err)
	}
	if t.Version > 1 {
		return Test{}, fmt.Errorf("%w: version %d", ErrTooNew, t.Version)
	}
	if t.Palette == "" {
		t.Palette = DefaultPalette
	}
	if !slices.Contains(palettes, t.Palette) {
		return Test{}, fmt.Errorf("testfmt: unknown palette %q", t.Palette)
	}
	for i := range t.Questions {
		q := &t.Questions[i]
		if q.Type != "single" && q.Type != "multi" {
			return Test{}, fmt.Errorf("testfmt: question %q: unknown type %q", q.ID, q.Type)
		}
		if q.Points < minPoints || q.Points > maxPoints {
			return Test{}, fmt.Errorf("testfmt: question %q: points %d outside %d-%d", q.ID, q.Points, minPoints, maxPoints)
		}
		var err error
		if q.Text, err = canonical(q.Text, rich.Block); err != nil {
			return Test{}, fmt.Errorf("testfmt: question %q text: %w", q.ID, err)
		}
		for j := range q.Options {
			o := &q.Options[j]
			if o.Content, err = canonical(o.Content, rich.Inline); err != nil {
				return Test{}, fmt.Errorf("testfmt: question %q option %q: %w", q.ID, o.ID, err)
			}
			if im := o.Image; im != nil && (rich.MediaKind(im.Src) != "image" || im.W < 1 || im.W > maxImageSide || im.H < 1 || im.H > maxImageSide) {
				return Test{}, fmt.Errorf("testfmt: question %q option %q: invalid image", q.ID, o.ID)
			}
		}
	}
	return t, nil
}

// Media returns the name of every image and audio file the test uses, in
// question order, without repeats: those in question text, in option content
// and in option images.
func (t Test) Media() []string {
	var out []string
	add := func(name string) {
		if !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	addDoc := func(raw json.RawMessage, mode rich.Mode) {
		// A field that does not parse names no media.
		if doc, err := rich.Parse(raw, mode); err == nil {
			for _, name := range doc.Media() {
				add(name)
			}
		}
	}
	for _, q := range t.Questions {
		addDoc(q.Text, rich.Block)
		for _, o := range q.Options {
			addDoc(o.Content, rich.Inline)
			if o.Image != nil {
				add(o.Image.Src)
			}
		}
	}
	return out
}

// emptyDoc is the canonical form of a rich field with no content, including a
// missing or null field: the builder autosaves drafts that have no text yet.
const emptyDoc = `{"type":"doc","content":[]}`

func canonical(raw json.RawMessage, mode rich.Mode) (json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return json.RawMessage(emptyDoc), nil
	}
	doc, err := rich.Parse(raw, mode)
	if err != nil {
		return nil, err
	}
	if len(doc.Content) == 0 {
		return json.RawMessage(emptyDoc), nil
	}
	return json.Marshal(doc)
}
