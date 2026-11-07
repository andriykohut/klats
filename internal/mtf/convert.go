package mtf

import (
	"cmp"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/andriykohut/klats/internal/media"
	"github.com/andriykohut/klats/internal/rich"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// The caps testfmt.Decode puts on a test, which a converted test keeps to.
const (
	maxItems     = 50  // entries of one list of a question
	maxAccepted  = 200 // runes of an accepted answer
	maxDrawLines = 100
	maxDrawCount = 1000
	maxPoints    = 12
	maxMinutes   = 300
	// maxThemeName is the runes of a theme name a tag keeps, leaving room
	// for a " (n)" suffix within the 200 of a tag.
	maxThemeName = 190
)

// typeIDs holds the Klats type of each question type of the older format.
var typeIDs = [...]string{1: "single", 2: "multi", 3: "order", 4: "match", 5: "truefalse", 6: "number", 7: "short", 8: "hotspot"}

var hardBreak = rich.Node{Type: "hardBreak"}

// converter turns the questions of a [File] into those of a test, storing the
// pictures of their RTF text, and keeps count of what the question it is on
// lost.
type converter struct {
	ms *media.Store
	// pictures holds the media table pictures that were stored, by key.
	pictures map[string]testfmt.Image
	lost     int  // pictures not carried over
	cut      bool // text dropped
}

// convert returns f as a test with default settings and an empty ID, and its
// notes, in question order. pictures holds the media table pictures stored, by
// key; a question whose key is missing from it loses its picture. The error is
// a store failure, or wraps [ErrDamaged] for a number question whose bounds are
// not finite.
func convert(f File, ms *media.Store, pictures map[string]testfmt.Image) (testfmt.Test, []wire.OpenNote, error) {
	t := testfmt.Test{Version: 1, Title: strings.TrimSpace(f.Title), Palette: testfmt.DefaultPalette, Settings: testfmt.DefaultSettings(), Questions: []testfmt.Question{}}
	if f.TimeLimit > 0 {
		t.Settings.TimeLimit = testfmt.TimeLimit{Mode: testfmt.TimeStudent, Minutes: min((f.TimeLimit+59)/60, maxMinutes)}
	}
	tags, draw := themes(f)
	t.Settings.Draw = draw
	var notes []wire.OpenNote
	c := converter{ms: ms, pictures: pictures}
	for i, src := range f.Questions {
		q, qn, err := c.question(fmt.Sprintf("q%d", i+1), src)
		if err != nil {
			return testfmt.Test{}, nil, err
		}
		if tag, ok := tags[src.ThemeID]; ok {
			q.Tags = []string{tag}
		}
		t.Questions = append(t.Questions, q)
		notes = append(notes, qn...)
	}
	return t, notes, nil
}

// themes returns the tag of the questions of each theme, by theme id, and
// the draw lines that ask what f asks. With one theme holding questions there
// are no tags, and one line from the whole test when the theme asks some but
// not all of them at random. With more, each theme holding questions is a tag
// named after it, or after its id when the name is empty, the name cut to 190
// runes and a repeated name numbered " (2)", " (3)" in theme order. When any
// of them asks at random, each gets a line in theme order: as many as it asks,
// at most its size; none when it asks 0, since then none of it is asked; and
// all of it when it does not ask at random. Counts and lines are cut to the
// caps of testfmt.
func themes(f File) (tags map[uint32]string, draw []testfmt.DrawLine) {
	size := map[uint32]int{}
	for _, q := range f.Questions {
		size[q.ThemeID]++
	}
	var held []Theme
	for _, t := range f.Themes {
		if size[t.ID] > 0 {
			held = append(held, t)
		}
	}
	if len(held) == 1 {
		if t := held[0]; t.AskOn && t.Ask > 0 && t.Ask < size[t.ID] {
			draw = []testfmt.DrawLine{{Count: min(t.Ask, maxDrawCount)}}
		}
		return nil, draw
	}
	tags = map[uint32]string{}
	seen := map[string]int{}
	picks := false
	for _, t := range held {
		name := strings.TrimSpace(t.Name)
		if name == "" {
			name = strconv.FormatUint(uint64(t.ID), 10)
		}
		if r := []rune(name); len(r) > maxThemeName {
			name = strings.TrimSpace(string(r[:maxThemeName]))
		}
		if seen[name]++; seen[name] > 1 {
			name += fmt.Sprintf(" (%d)", seen[name])
		}
		tags[t.ID] = name
		picks = picks || t.AskOn
		switch n := size[t.ID]; {
		case !t.AskOn:
			draw = append(draw, testfmt.DrawLine{Tag: name, Count: min(n, maxDrawCount)})
		case t.Ask > 0:
			draw = append(draw, testfmt.DrawLine{Tag: name, Count: min(t.Ask, n, maxDrawCount)})
		}
	}
	if !picks {
		return tags, nil
	}
	return tags, draw[:min(len(draw), maxDrawLines)]
}

// question returns src converted into the question id, and the notes on it.
func (c *converter) question(id string, src Question) (testfmt.Question, []wire.OpenNote, error) {
	c.lost, c.cut = 0, false
	// Decode clears ShuffleOptions and Partial on the types that do not use
	// them.
	q := testfmt.Question{ID: id, Type: typeIDs[src.Type], Points: min(max(src.Points, 1), maxPoints), ShuffleOptions: true, Partial: true}
	text, err := c.blocks(src.Text)
	if err != nil {
		return testfmt.Question{}, nil, err
	}
	var extra int
	var reshaped bool
	switch src.Type {
	case 1, 2, 5:
		q.Options, err = c.options(id, src.Answers)
		for i := range q.Options {
			q.Options[i].Correct = src.Keys[i] == 1
		}
	case 3:
		var items []int
		for i, k := range src.Keys {
			if k == 0 {
				extra++
			} else {
				items = append(items, i)
			}
		}
		slices.SortStableFunc(items, func(a, b int) int { return cmp.Compare(src.Keys[a], src.Keys[b]) })
		ordered := make([]string, len(items))
		for i, at := range items {
			ordered[i] = src.Answers[at]
		}
		q.Options, err = c.options(id, ordered)
	case 4:
		err = c.match(&q, src)
	case 6:
		switch {
		case !finite(src.Lo) || !finite(src.Hi):
			err = damaged("number bounds %v and %v", src.Lo, src.Hi)
		case src.Lo == src.Hi:
			q.Number = &testfmt.NumberKey{Mode: "exact", Value: src.Lo}
		default:
			q.Number = &testfmt.NumberKey{Mode: "range", Min: src.Lo, Max: src.Hi}
		}
	case 7:
		q.Accepted = c.accepted(src.Accepted)
	case 8:
		reshaped = c.hotspot(&q, src)
	}
	if err != nil {
		return testfmt.Question{}, nil, err
	}
	if src.Type != 8 && src.Picture != "" {
		if im, ok := c.pictures[src.Picture]; ok {
			text = append(text, imageNode(im))
		} else {
			c.lost++
		}
	}
	q.Text = docJSON(text...)

	var notes []wire.OpenNote
	note := func(on bool, code string, count int) {
		if on {
			notes = append(notes, wire.OpenNote{QuestionID: id, Code: code, Count: count})
		}
	}
	note(c.lost > 0, "image_lost", c.lost)
	note(reshaped, "area_reshaped", 0)
	note(extra > 0, "order_extra_dropped", extra)
	note(src.Hint != "" || src.Comment != "", "hint_dropped", 0)
	note(c.cut, "text_cut", 0)
	return q, notes, nil
}

// options returns an option for each of the first 50 answers, with ids
// numbered from 1 after the question id.
func (c *converter) options(id string, answers []string) ([]testfmt.Option, error) {
	var out []testfmt.Option
	for i, a := range answers[:min(len(answers), maxItems)] {
		content, im, err := c.inline(a)
		if err != nil {
			return nil, err
		}
		out = append(out, testfmt.Option{ID: fmt.Sprintf("%so%d", id, i+1), Content: content, Image: im})
	}
	return out, nil
}

// match fills in a matching question: the left items are its options and the
// right ones its targets. A left item whose key is out of range, or names a
// right item an earlier one has, gets no target, since Decode refuses one
// that two items share.
func (c *converter) match(q *testfmt.Question, src Question) error {
	for i, r := range src.Right[:min(len(src.Right), maxItems)] {
		content, im, err := c.inline(r)
		if err != nil {
			return err
		}
		q.Targets = append(q.Targets, testfmt.Target{ID: fmt.Sprintf("%st%d", q.ID, i+1), Content: content, Image: im})
	}
	var err error
	if q.Options, err = c.options(q.ID, src.Answers); err != nil {
		return err
	}
	taken := map[uint32]bool{}
	for i := range q.Options {
		if k := src.Keys[i]; k >= 1 && int(k) <= len(q.Targets) && !taken[k] {
			q.Options[i].Target, taken[k] = q.Targets[k-1].ID, true
		}
	}
	return nil
}

// accepted returns the non-empty lines of s, trimmed, at most 50 of them and
// each of at most 200 runes, marking the text cut when that drops any.
func (c *converter) accepted(s string) []string {
	var out []string
	for line := range strings.Lines(s) {
		line = strings.TrimSpace(line)
		switch {
		case line == "":
			continue
		case len(out) == maxItems:
			c.cut = true
			return out
		case utf8.RuneCountInString(line) > maxAccepted:
			line, c.cut = string([]rune(line)[:maxAccepted]), true
		}
		out = append(out, line)
	}
	return out
}

// hotspot fills in the image and areas of a hotspot question, at most 50,
// and reports whether a region became its bounding box. Without the picture
// the question has neither.
func (c *converter) hotspot(q *testfmt.Question, src Question) (reshaped bool) {
	im, ok := c.pictures[src.Picture]
	if !ok {
		c.lost++
		return false
	}
	q.Image = &im
	for _, r := range src.Regions {
		a, rect, ok := area(r, im)
		if !ok || len(q.Areas) == maxItems {
			continue
		}
		a.ID = fmt.Sprintf("%sa%d", q.ID, len(q.Areas)+1)
		q.Areas = append(q.Areas, a)
		reshaped = reshaped || !rect
	}
	return reshaped
}

// area returns the bounding box of region, clamped to a picture of im's size,
// as fractions of that size, and whether region is a 4-point rectangle with
// sides along the axes. ok is false for a box of zero width or height.
func area(region []Point, im testfmt.Image) (a testfmt.Area, rect, ok bool) {
	x0, y0, x1, y1 := math.MaxInt, math.MaxInt, 0, 0
	for _, p := range region {
		x0, y0, x1, y1 = min(x0, p.X), min(y0, p.Y), max(x1, p.X), max(y1, p.Y)
	}
	x0, x1, y0, y1 = min(x0, im.W), min(x1, im.W), min(y0, im.H), min(y1, im.H)
	if x1 <= x0 || y1 <= y0 {
		return testfmt.Area{}, false, false
	}
	w, h := float64(im.W), float64(im.H)
	a = testfmt.Area{Shape: "rect", X: float64(x0) / w, Y: float64(y0) / h, W: float64(x1-x0) / w, H: float64(y1-y0) / h}
	rect = len(region) == 4
	for i, p := range region {
		next := region[(i+1)%len(region)]
		rect = rect && (p.X == next.X || p.Y == next.Y)
	}
	return a, rect, true
}

// blocks returns the RTF document src as the blocks of question text: its
// paragraphs, split around its pictures, each picture an image block or lost.
func (c *converter) blocks(src string) ([]rich.Node, error) {
	t := c.parse(src)
	var out []rich.Node
	for _, para := range t.Paras {
		var runs []rich.Node
		pictured := false
		for _, n := range para {
			if n.Type != "image" {
				runs = append(runs, n)
				continue
			}
			if len(runs) > 0 {
				out = append(out, paragraph(runs))
				runs = nil
			}
			pictured = true
			im, ok, err := c.pict(t, n)
			if err != nil {
				return nil, err
			}
			if ok {
				out = append(out, imageNode(im))
			} else {
				c.lost++
			}
		}
		if len(runs) > 0 || !pictured {
			out = append(out, paragraph(runs))
		}
	}
	return out, nil
}

// inline returns the RTF document src as option or target content, its
// paragraphs joined by line breaks into one, leaving out the paragraphs that
// hold only pictures and the blank lines they leave at the start, and its
// first picture that stores; every other picture is lost.
func (c *converter) inline(src string) (json.RawMessage, *testfmt.Image, error) {
	t := c.parse(src)
	var runs []rich.Node
	var im *testfmt.Image
	for _, para := range t.Paras {
		var line []rich.Node
		for _, n := range para {
			switch {
			case n.Type != "image":
				line = append(line, n)
			case im == nil:
				got, ok, err := c.pict(t, n)
				if err != nil {
					return nil, nil, err
				}
				if ok {
					im = &got
				} else {
					c.lost++
				}
			default:
				c.lost++
			}
		}
		if len(line) == 0 && len(para) > 0 {
			continue
		}
		if len(runs) > 0 {
			runs = append(runs, hardBreak)
		}
		runs = append(runs, line...)
	}
	return docJSON(paragraph(runs)), im, nil
}

func (c *converter) parse(src string) rtfText {
	t := parseRTF(src)
	c.cut = c.cut || t.Cut
	return t
}

// pict stores the picture the image placeholder n of t refers to.
func (c *converter) pict(t rtfText, n rich.Node) (testfmt.Image, bool, error) {
	i, _ := strconv.Atoi(strings.TrimPrefix(n.Attrs.Src, "pict:"))
	return pictPicture(c.ms, t.Picts[i])
}

func paragraph(runs []rich.Node) rich.Node { return rich.Node{Type: "paragraph", Content: runs} }

func imageNode(im testfmt.Image) rich.Node {
	return rich.Node{Type: "image", Attrs: &rich.Attrs{Src: im.Src, W: im.W, H: im.H}}
}

// docJSON returns a document of blocks as JSON.
func docJSON(blocks ...rich.Node) json.RawMessage {
	b, _ := json.Marshal(rich.Doc{Type: "doc", Content: blocks}) // rich nodes always marshal
	return b
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
