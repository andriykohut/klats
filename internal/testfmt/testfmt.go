// Package testfmt defines the test document a teacher builds and the
// validation checks shared by the builder and the start-of-test gate.
package testfmt

import (
	"bytes"
	"encoding/json"
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
}

const (
	DefaultPalette = "teal"
	minPoints      = 1
	maxPoints      = 12
)

var palettes = []string{DefaultPalette, "grape", "coral", "lavender", "classic"}

// Decode parses and validates a test document. An empty palette becomes
// DefaultPalette. Every rich-text field is replaced by the canonical JSON of
// its parsed rich.Doc (a missing or null field becomes an empty document), so callers persist the result rather than the input.
// Content problems such as a missing correct option are not errors here; see
// Test.Problems.
func Decode(raw []byte) (Test, error) {
	var t Test
	if err := json.Unmarshal(raw, &t); err != nil {
		return Test{}, fmt.Errorf("testfmt: %w", err)
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
		}
	}
	return t, nil
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
