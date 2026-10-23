// Package rich validates and reads the rich text stored for questions and
// answer options: a strict subset of ProseMirror JSON, as produced by TipTap.
//
// Stored documents are rendered by the front end from the node tree, never as
// HTML, so Parse is the single trust boundary: anything it accepts is safe to
// persist and render, and anything outside the allow-list is rejected. Which
// nodes and marks a document may hold depends on its [Mode]. Media (images and
// audio) are referenced by name only, never by URL or data; [MediaKind] is the
// one rule for what a media name looks like.
package rich

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

const (
	maxTextRunes = 20000
	maxDepth     = 8
	maxLatex     = 1000
	maxPixels    = 10000
	maxSpan      = 20
	maxGapID     = 32

	gapIDChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
	hexDigits  = "0123456789abcdef"
)

// ErrInvalid is wrapped by every error Parse returns.
var ErrInvalid = errors.New("invalid rich text")

// Mode selects which nodes and marks a document may contain.
type Mode int

const (
	// Block (question text) permits paragraphs, hard breaks, bullet and ordered
	// lists, code blocks, tables, images, audio and math.
	Block Mode = iota
	// Inline (options and targets) permits paragraphs, hard breaks and math.
	Inline
	// Gapped (gap and bank text) permits what Inline does, plus gaps.
	Gapped
	// Marked (highlight text) permits paragraphs and hard breaks, plus the
	// target mark.
	Marked
)

// Doc is the root of a rich-text document.
type Doc struct {
	Type    string `json:"type"`
	Content []Node `json:"content,omitempty"`
}

// Node is a block or inline node. Only text nodes carry Text and Marks, and
// only image, audio, math, gap, tableHeader and tableCell nodes carry Attrs.
type Node struct {
	Type    string `json:"type"`
	Attrs   *Attrs `json:"attrs,omitempty"`
	Text    string `json:"text,omitempty"`
	Marks   []Mark `json:"marks,omitempty"`
	Content []Node `json:"content,omitempty"`
}

// Attrs holds the node attributes. Each node type uses a fixed subset: Src, W
// and H for image (Src alone for audio), Latex for math, ID for gap, and
// Colspan and Rowspan for table cells. A zero field is absent.
type Attrs struct {
	Src     string `json:"src,omitempty"`
	W       int    `json:"w,omitempty"`
	H       int    `json:"h,omitempty"`
	Latex   string `json:"latex,omitempty"`
	ID      string `json:"id,omitempty"`
	Colspan int    `json:"colspan,omitempty"`
	Rowspan int    `json:"rowspan,omitempty"`
}

// Mark is a text style. Marks carry no attributes.
type Mark struct {
	Type string `json:"type"`
}

var textNodes = []string{"paragraph", "text", "hardBreak"}

var modeNodes = map[Mode]map[string]bool{
	Block: nodeSet(textNodes, "math", "bulletList", "orderedList", "listItem", "codeBlock",
		"table", "tableRow", "tableHeader", "tableCell", "image", "audio"),
	Inline: nodeSet(textNodes, "math"),
	Gapped: nodeSet(textNodes, "math", "gap"),
	Marked: nodeSet(textNodes),
}

func nodeSet(base []string, more ...string) map[string]bool {
	set := map[string]bool{}
	for _, n := range append(append([]string{}, base...), more...) {
		set[n] = true
	}
	return set
}

// childNodes lists the only children a node may hold. Leaves map to an empty
// set.
var childNodes = map[string]map[string]bool{
	"codeBlock":   {"text": true},
	"table":       {"tableRow": true},
	"tableRow":    {"tableHeader": true, "tableCell": true},
	"tableHeader": {"paragraph": true},
	"tableCell":   {"paragraph": true},
	"image":       {},
	"audio":       {},
	"math":        {},
	"gap":         {},
}

var allowedKeys = map[string]bool{"type": true, "attrs": true, "text": true, "marks": true, "content": true}

var allowedAttrKeys = map[string]bool{"src": true, "w": true, "h": true, "latex": true, "id": true, "colspan": true, "rowspan": true}

var allowedMarks = map[string]bool{"bold": true, "italic": true, "subscript": true, "superscript": true, "code": true}

// Parse decodes raw and validates it against mode. It rejects object keys
// other than exactly type, attrs, text, marks and content (case-sensitive, no
// duplicates) at every level, and attrs keys other than src, w, h, latex, id,
// colspan and rowspan. It also rejects nodes and marks the mode does not
// permit, attrs a node type does not take or whose values are out of range,
// children a node may not hold (table, row and cell nesting, and unmarked text
// only in a codeBlock), repeated gap ids, text and LaTeX totalling more than
// 20,000 runes, and nesting deeper than 8 levels below the doc node. Every
// error wraps [ErrInvalid].
//
// The key check keeps Go and JavaScript reading the same bytes the same way:
// encoding/json would otherwise match keys case-insensitively and let the last
// duplicate win. Callers persist json.Marshal of the returned Doc, which is
// canonical, rather than raw. The returned Doc leaves out empty text nodes,
// at every level.
func Parse(raw []byte, mode Mode) (Doc, error) {
	keys := json.NewDecoder(bytes.NewReader(raw))
	if err := checkKeys(keys, allowedKeys); err != nil {
		return Doc{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if _, err := keys.Token(); err != io.EOF {
		return Doc{}, fmt.Errorf("%w: unexpected data after document", ErrInvalid)
	}
	var doc Doc
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		return Doc{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	if doc.Type != "doc" {
		return Doc{}, fmt.Errorf("%w: root must be doc, got %q", ErrInvalid, doc.Type)
	}
	c := checker{nodes: modeNodes[mode], target: mode == Marked, gaps: map[string]bool{}}
	if err := c.checkNodes(doc.Content, "doc", 1); err != nil {
		return Doc{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	doc.Content = withoutEmptyText(doc.Content)
	return doc, nil
}

// withoutEmptyText returns nodes without their empty text nodes, at every
// level, reusing the slices. ProseMirror forbids empty text nodes, and TipTap
// warns when it loads one.
func withoutEmptyText(nodes []Node) []Node {
	out := nodes[:0]
	for _, n := range nodes {
		if n.Type == "text" && n.Text == "" {
			continue
		}
		n.Content = withoutEmptyText(n.Content)
		out = append(out, n)
	}
	return out
}

// checkKeys consumes one JSON value from dec, failing on any object key that is
// not in allowed or that repeats within its object. The value of an attrs key
// is checked against allowedAttrKeys.
func checkKeys(dec *json.Decoder, allowed map[string]bool) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	delim, ok := tok.(json.Delim)
	if !ok {
		return nil
	}
	seen := map[string]bool{}
	for dec.More() {
		next := allowedKeys
		if delim == '{' {
			kt, err := dec.Token()
			if err != nil {
				return err
			}
			key := kt.(string)
			if !allowed[key] {
				return fmt.Errorf("key %q not allowed", key)
			}
			if key == "attrs" {
				next = allowedAttrKeys
			}
			if seen[key] {
				return fmt.Errorf("duplicate key %q", key)
			}
			seen[key] = true
		}
		if err := checkKeys(dec, next); err != nil {
			return err
		}
	}
	_, err = dec.Token() // closing delimiter
	return err
}

// checker holds the state of one validation pass.
type checker struct {
	nodes  map[string]bool // node types the mode permits
	target bool            // whether the target mark is permitted
	gaps   map[string]bool // gap ids seen so far
	runes  int             // text and LaTeX runes seen so far
}

func (c *checker) checkNodes(nodes []Node, parent string, depth int) error {
	for _, n := range nodes {
		if depth > maxDepth {
			return fmt.Errorf("nesting deeper than %d", maxDepth)
		}
		if !c.nodes[n.Type] {
			return fmt.Errorf("node %q not allowed", n.Type)
		}
		if kids, ok := childNodes[parent]; ok && !kids[n.Type] {
			return fmt.Errorf("%s node not allowed in %s", n.Type, parent)
		}
		if n.Type == "text" {
			if len(n.Content) > 0 {
				return errors.New("text node has content")
			}
			if err := c.count(utf8.RuneCountInString(n.Text)); err != nil {
				return err
			}
			for _, m := range n.Marks {
				if known := allowedMarks[m.Type] || c.target && m.Type == "target"; !known {
					return fmt.Errorf("mark %q not allowed", m.Type)
				}
				if parent == "codeBlock" {
					return errors.New("codeBlock text has marks")
				}
			}
		} else if n.Text != "" || len(n.Marks) > 0 {
			return fmt.Errorf("%s node has text or marks", n.Type)
		}
		if err := c.checkAttrs(n); err != nil {
			return err
		}
		if err := c.checkNodes(n.Content, n.Type, depth+1); err != nil {
			return err
		}
	}
	return nil
}

func (c *checker) count(runes int) error {
	c.runes += runes
	if c.runes > maxTextRunes {
		return fmt.Errorf("text longer than %d characters", maxTextRunes)
	}
	return nil
}

// checkAttrs validates n's attrs: exactly the keys its type takes, with values
// in range. It clears each field it validates, so any field left over was not
// meant for this node type.
func (c *checker) checkAttrs(n Node) error {
	if n.Attrs == nil {
		switch n.Type {
		case "image", "audio", "math", "gap":
			return fmt.Errorf("%s node needs attrs", n.Type)
		}
		return nil
	}
	a := *n.Attrs
	switch n.Type {
	case "image":
		if MediaKind(a.Src) != "image" {
			return fmt.Errorf("image src %q is not an image name", a.Src)
		}
		if a.W < 1 || a.W > maxPixels || a.H < 1 || a.H > maxPixels {
			return fmt.Errorf("image size must be 1 to %d", maxPixels)
		}
		a.Src, a.W, a.H = "", 0, 0
	case "audio":
		if MediaKind(a.Src) != "audio" {
			return fmt.Errorf("audio src %q is not an audio name", a.Src)
		}
		a.Src = ""
	case "math":
		runes := utf8.RuneCountInString(a.Latex)
		if runes < 1 || runes > maxLatex {
			return fmt.Errorf("latex must be 1 to %d characters", maxLatex)
		}
		if err := c.count(runes); err != nil {
			return err
		}
		a.Latex = ""
	case "gap":
		if !validGapID(a.ID) {
			return fmt.Errorf("gap id %q must be 1 to %d of A-Z, a-z, 0-9, _ and -", a.ID, maxGapID)
		}
		if c.gaps[a.ID] {
			return fmt.Errorf("gap id %q repeats", a.ID)
		}
		c.gaps[a.ID] = true
		a.ID = ""
	case "tableHeader", "tableCell":
		if a.Colspan < 0 || a.Colspan > maxSpan || a.Rowspan < 0 || a.Rowspan > maxSpan {
			return fmt.Errorf("colspan and rowspan must be 1 to %d", maxSpan)
		}
		a.Colspan, a.Rowspan = 0, 0
	default:
		return fmt.Errorf("%s node takes no attrs", n.Type)
	}
	if a != (Attrs{}) {
		return fmt.Errorf("%s node has attrs it does not take", n.Type)
	}
	return nil
}

func validGapID(id string) bool {
	if id == "" || len(id) > maxGapID {
		return false
	}
	for _, r := range id {
		if !strings.ContainsRune(gapIDChars, r) {
			return false
		}
	}
	return true
}

// MediaKind returns "image" or "audio" if name is a media name, and "" if not.
// A media name is 64 lowercase hex digits (the content hash), a dot, and an
// extension: jpg, png, gif or webp for images; mp3, m4a, ogg or wav for audio.
// It does no I/O.
func MediaKind(name string) string {
	hash, ext, ok := strings.Cut(name, ".")
	if !ok || len(hash) != 64 {
		return ""
	}
	for _, r := range hash {
		if !strings.ContainsRune(hexDigits, r) {
			return ""
		}
	}
	switch ext {
	case "jpg", "png", "gif", "webp":
		return "image"
	case "mp3", "m4a", "ogg", "wav":
		return "audio"
	}
	return ""
}

// Media returns the src of every image and audio node, in document order,
// without repeats.
func (d Doc) Media() []string {
	var out []string
	seen := map[string]bool{}
	walk(d.Content, func(n Node) {
		if (n.Type == "image" || n.Type == "audio") && n.Attrs != nil && !seen[n.Attrs.Src] {
			seen[n.Attrs.Src] = true
			out = append(out, n.Attrs.Src)
		}
	})
	return out
}

// GapIDs returns the id of every gap node, in document order.
func (d Doc) GapIDs() []string {
	var out []string
	walk(d.Content, func(n Node) {
		if n.Type == "gap" && n.Attrs != nil {
			out = append(out, n.Attrs.ID)
		}
	})
	return out
}

func walk(nodes []Node, visit func(Node)) {
	for _, n := range nodes {
		visit(n)
		walk(n.Content, visit)
	}
}

// PlainText returns the document's text with blocks (paragraphs, list items,
// table rows) and hard breaks separated by newlines and all formatting dropped.
// Math gives its LaTeX, a gap gives "___", table cells in a row are joined by a
// tab, and images and audio give "".
func (d Doc) PlainText() string {
	return joinBlocks(d.Content)
}

// IsEmpty reports whether the document has no text other than whitespace and
// holds no image, audio or math.
func (d Doc) IsEmpty() bool {
	visual := false
	walk(d.Content, func(n Node) {
		visual = visual || n.Type == "image" || n.Type == "audio" || n.Type == "math"
	})
	return !visual && strings.TrimSpace(d.PlainText()) == ""
}

func joinBlocks(nodes []Node) string {
	parts := make([]string, len(nodes))
	for i, n := range nodes {
		parts[i] = n.plainText()
	}
	return strings.Join(parts, "\n")
}

func (n Node) plainText() string {
	switch n.Type {
	case "text":
		return n.Text
	case "hardBreak":
		return "\n"
	case "math":
		return n.Attrs.Latex
	case "gap":
		return "___"
	case "paragraph", "codeBlock":
		var b strings.Builder
		for _, c := range n.Content {
			b.WriteString(c.plainText())
		}
		return b.String()
	case "tableRow":
		cells := make([]string, len(n.Content))
		for i, c := range n.Content {
			cells[i] = c.plainText()
		}
		return strings.Join(cells, "\t")
	}
	return joinBlocks(n.Content)
}
