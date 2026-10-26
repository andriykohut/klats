// Package testfmt defines the test document a teacher builds and the
// validation checks shared by the builder and the start-of-test gate.
package testfmt

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"klats/internal/rich"
)

// Test is a teacher-authored test. Rich-text fields hold canonical rich.Doc JSON.
type Test struct {
	ID        string     `json:"id"`
	Version   int        `json:"version"`
	Title     string     `json:"title"`
	Palette   string     `json:"palette"`
	Settings  Settings   `json:"settings"`
	Questions []Question `json:"questions"`
}

// Question is one question of a test. Type is one of the ids in kinds, and the
// type's row there says which of the other fields it keeps: [Decode] drops the
// rest.
type Question struct {
	ID             string          `json:"id"`
	Type           string          `json:"type"`
	Text           json.RawMessage `json:"text"`
	Points         int             `json:"points"`
	ShuffleOptions bool            `json:"shuffleOptions"`
	Partial        bool            `json:"partial"`
	Options        []Option        `json:"options"`
	Targets        []Target        `json:"targets,omitempty"`
	Body           json.RawMessage `json:"body,omitempty"`
	Gaps           []Gap           `json:"gaps,omitempty"`
	Image          *Image          `json:"image,omitempty"`
	Areas          []Area          `json:"areas,omitempty"`
	Accepted       []string        `json:"accepted,omitempty"`
	Match          *Match          `json:"match,omitempty"`
	Number         *NumberKey      `json:"number,omitempty"`
	Rubric         string          `json:"rubric,omitempty"`
}

// Option is a choice, statement, row, item, word or label. Target is the id of
// the target or body gap it belongs under, or empty for none.
type Option struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
	Correct bool            `json:"correct"`
	Target  string          `json:"target,omitempty"`
	Image   *Image          `json:"image,omitempty"`
}

// Target is a column, group, right-hand side or point that options go under.
// X and Y place a point on the question's image, as fractions of its size.
type Target struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
	Image   *Image          `json:"image,omitempty"`
	X       float64         `json:"x"`
	Y       float64         `json:"y"`
}

// Gap is a blank in a question's body. A gap with Choices is a list the
// student picks from; one without takes typed text equal to one of Accepted.
type Gap struct {
	ID       string   `json:"id"`
	Accepted []string `json:"accepted,omitempty"`
	Choices  []Choice `json:"choices,omitempty"`
}

// Choice is an entry of a list gap.
type Choice struct {
	ID      string `json:"id"`
	Text    string `json:"text"`
	Correct bool   `json:"correct"`
}

// Area is a region of a hotspot question's image, as fractions of its size.
// X, Y is the top-left corner of a W by H box. Shape is "rect", the box itself,
// or "ellipse", the ellipse inscribed in it; [Decode] rejects any other.
type Area struct {
	ID    string  `json:"id"`
	Shape string  `json:"shape"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
}

// Match holds the switches for comparing typed text with the accepted answers.
type Match struct {
	CaseSensitive     bool `json:"caseSensitive"`
	StrictApostrophes bool `json:"strictApostrophes"`
	StrictLetters     bool `json:"strictLetters"`
	AllowTypo         bool `json:"allowTypo"`
}

// NumberKey is the right answer of a number question. Mode is "exact" (Value),
// "tolerance" (Value within Tolerance) or "range" (Min to Max).
type NumberKey struct {
	Mode      string  `json:"mode"`
	Value     float64 `json:"value"`
	Tolerance float64 `json:"tolerance"`
	Min       float64 `json:"min"`
	Max       float64 `json:"max"`
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

	// maxListLen caps the entries of every list of a question, maxTextRunes an
	// accepted text or a choice and maxRubricRunes a rubric.
	maxListLen     = 50
	maxTextRunes   = 200
	maxRubricRunes = 2000
)

var palettes = []string{DefaultPalette, "grape", "coral", "lavender", "classic"}

// ErrTooNew is returned by [Decode] for a test whose version is above 1, the
// only format this program reads: a newer program made it.
var ErrTooNew = errors.New("testfmt: test made by a newer version")

// Decode parses and validates a test document, returning [ErrTooNew] for a
// version above 1. An empty palette becomes DefaultPalette. Settings left
// empty (an empty mode, kind, reveal or navigation, nil thresholds, a zero pass
// mark) become those of [DefaultSettings], so a test without settings decodes
// to the defaults and Scale.Thresholds is never nil. A time limit mode other
// than "none", "student" or "common", minutes outside 0-300 (or 0 unless the
// mode is "none"), a subset outside 0-1000, a scale kind other than "points12",
// "percent" or "pass", thresholds that are not 11 strictly rising values in
// 1-100, a pass mark outside 1-100, a reveal other than "grade", "mistakes" or
// "nothing" and a navigation other than "free" or "forward" are errors. Every
// rich-text field is replaced by the canonical JSON of its parsed rich.Doc (a
// missing or null field becomes an empty document), so callers persist the
// result rather than the input. Each question keeps only the fields its type
// uses, though Options is never nil, so it encodes as a list (empty for a type
// without options), as the TypeScript type promises. An option's Target that names no
// target or body gap is cleared, and a gaps question's Gaps are brought in
// line with its body: one entry for each gap node, in body order. A list of
// over 50 entries or with a repeated id (for gaps, both before and after that
// step), an accepted text or choice of over 200 characters, a rubric of over
// 2,000, a coordinate outside 0 to 1, an area shape other than "rect" or
// "ellipse", a word bank gap with more than one word, a matching target shared
// by two left items and a label point shared by two labels are errors.
// Content problems such as a missing correct option are not errors here; see
// Test.Problems.
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
	if err := t.Settings.decode(); err != nil {
		return Test{}, fmt.Errorf("testfmt: settings: %w", err)
	}
	for i := range t.Questions {
		q := &t.Questions[i]
		if err := q.decode(); err != nil {
			return Test{}, fmt.Errorf("testfmt: question %q: %w", q.ID, err)
		}
	}
	return t, nil
}

func (q *Question) decode() error {
	k, ok := kinds[q.Type]
	if !ok {
		return fmt.Errorf("unknown type %q", q.Type)
	}
	if q.Points < minPoints || q.Points > maxPoints {
		return fmt.Errorf("points %d outside %d-%d", q.Points, minPoints, maxPoints)
	}
	q.dropUnused(k.uses)
	if q.Options == nil {
		q.Options = []Option{}
	}
	var err error
	if q.Text, err = canonical(q.Text, rich.Block); err != nil {
		return fmt.Errorf("text: %w", err)
	}
	if k.uses&useBody != 0 {
		if q.Body, err = canonical(q.Body, k.bodyMode); err != nil {
			return fmt.Errorf("body: %w", err)
		}
	}
	if err := checkImage(q.Image); err != nil {
		return err
	}
	if utf8.RuneCountInString(q.Rubric) > maxRubricRunes {
		return fmt.Errorf("rubric over %d characters", maxRubricRunes)
	}
	if err := checkTexts("accepted", q.Accepted); err != nil {
		return err
	}
	if err := q.decodeOptions(); err != nil {
		return err
	}
	if err := q.decodeTargets(); err != nil {
		return err
	}
	if k.uses&useGaps != 0 {
		if err := q.syncGaps(); err != nil {
			return err
		}
	}
	if err := q.checkGapsAndAreas(); err != nil {
		return err
	}
	q.clearDanglingTargets()
	if k.validate != nil {
		return k.validate(*q)
	}
	return nil
}

func (q *Question) decodeOptions() error {
	if err := checkIDs("options", q.Options, func(o Option) string { return o.ID }); err != nil {
		return err
	}
	for i := range q.Options {
		o := &q.Options[i]
		var err error
		if o.Content, err = canonical(o.Content, rich.Inline); err != nil {
			return fmt.Errorf("option %q: %w", o.ID, err)
		}
		if err := checkImage(o.Image); err != nil {
			return fmt.Errorf("option %q: %w", o.ID, err)
		}
	}
	return nil
}

func (q *Question) decodeTargets() error {
	if err := checkIDs("targets", q.Targets, func(g Target) string { return g.ID }); err != nil {
		return err
	}
	for i := range q.Targets {
		g := &q.Targets[i]
		var err error
		if g.Content, err = canonical(g.Content, rich.Inline); err != nil {
			return fmt.Errorf("target %q: %w", g.ID, err)
		}
		if err := checkImage(g.Image); err != nil {
			return fmt.Errorf("target %q: %w", g.ID, err)
		}
		if !inUnit(g.X, g.Y) {
			return fmt.Errorf("target %q: position outside 0-1", g.ID)
		}
	}
	return nil
}

func (q *Question) checkGapsAndAreas() error {
	if err := checkIDs("gaps", q.Gaps, func(g Gap) string { return g.ID }); err != nil {
		return err
	}
	for _, g := range q.Gaps {
		if err := checkTexts("accepted", g.Accepted); err != nil {
			return fmt.Errorf("gap %q: %w", g.ID, err)
		}
		if err := checkIDs("choices", g.Choices, func(c Choice) string { return c.ID }); err != nil {
			return fmt.Errorf("gap %q: %w", g.ID, err)
		}
		for _, c := range g.Choices {
			if utf8.RuneCountInString(c.Text) > maxTextRunes {
				return fmt.Errorf("gap %q: choice over %d characters", g.ID, maxTextRunes)
			}
		}
	}
	if err := checkIDs("areas", q.Areas, func(a Area) string { return a.ID }); err != nil {
		return err
	}
	for _, a := range q.Areas {
		if !inUnit(a.X, a.Y, a.W, a.H) {
			return fmt.Errorf("area %q: outside 0-1", a.ID)
		}
		if a.Shape != "rect" && a.Shape != "ellipse" {
			return fmt.Errorf("area %q: unknown shape %q", a.ID, a.Shape)
		}
	}
	return nil
}

// clearDanglingTargets empties the Target of every option that names neither a
// target nor a gap of the body.
func (q *Question) clearDanglingTargets() {
	known := map[string]bool{}
	for _, g := range q.Targets {
		known[g.ID] = true
	}
	if doc, err := rich.Parse(q.Body, kinds[q.Type].bodyMode); err == nil {
		for _, id := range doc.GapIDs() {
			known[id] = true
		}
	}
	for i := range q.Options {
		if !known[q.Options[i].Target] {
			q.Options[i].Target = ""
		}
	}
}

// checkIDs rejects a list that is too long or repeats an id.
func checkIDs[T any](list string, items []T, id func(T) string) error {
	if len(items) > maxListLen {
		return fmt.Errorf("%s: %d entries, at most %d", list, len(items), maxListLen)
	}
	seen := make(map[string]bool, len(items))
	for _, it := range items {
		if seen[id(it)] {
			return fmt.Errorf("%s: repeated id %q", list, id(it))
		}
		seen[id(it)] = true
	}
	return nil
}

func checkTexts(list string, texts []string) error {
	if len(texts) > maxListLen {
		return fmt.Errorf("%s: %d entries, at most %d", list, len(texts), maxListLen)
	}
	for _, s := range texts {
		if utf8.RuneCountInString(s) > maxTextRunes {
			return fmt.Errorf("%s: text over %d characters", list, maxTextRunes)
		}
	}
	return nil
}

func checkImage(im *Image) error {
	if im != nil && (rich.MediaKind(im.Src) != "image" || im.W < 1 || im.W > maxImageSide || im.H < 1 || im.H > maxImageSide) {
		return errors.New("invalid image")
	}
	return nil
}

func inUnit(vs ...float64) bool {
	for _, v := range vs {
		if !(v >= 0 && v <= 1) {
			return false
		}
	}
	return true
}

// PlainText returns the plain text of the question's text, then of its body on
// a new line. An empty or unparseable part gives nothing.
func (q Question) PlainText() string {
	var parts []string
	if doc, err := rich.Parse(q.Text, rich.Block); err == nil && doc.PlainText() != "" {
		parts = append(parts, doc.PlainText())
	}
	if doc, err := rich.Parse(q.Body, kinds[q.Type].bodyMode); err == nil && doc.PlainText() != "" {
		parts = append(parts, doc.PlainText())
	}
	return strings.Join(parts, "\n")
}

// Media returns the name of every image and audio file the test uses, in
// question order, without repeats: those in question text, the question's
// image, target content and images, option content and option images.
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
		if q.Image != nil {
			add(q.Image.Src)
		}
		for _, g := range q.Targets {
			addDoc(g.Content, rich.Inline)
			if g.Image != nil {
				add(g.Image.Src)
			}
		}
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
