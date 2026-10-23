package testfmt

import "strings"

// Answer is a student's answer to one question. A question type uses one of
// the fields: Items for picked or ordered ids, Pairs for placements, Text for
// typed answers and Point for a click on an image.
type Answer struct {
	Items []string          `json:"items,omitempty"`
	Pairs map[string]string `json:"pairs,omitempty"`
	Text  string            `json:"text,omitempty"`
	Point *Point            `json:"point,omitempty"`
}

// Point is a position on an image, as fractions of its width and height from
// its top-left corner.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// IsEmpty reports whether the answer holds nothing: no items, no pairs, only
// blank text and no point.
func (a Answer) IsEmpty() bool {
	return len(a.Items) == 0 && len(a.Pairs) == 0 && strings.TrimSpace(a.Text) == "" && a.Point == nil
}
