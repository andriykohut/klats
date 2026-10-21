// Package rich validates and reads the rich text stored for questions and
// answer options: a strict subset of ProseMirror JSON, as produced by TipTap.
//
// Stored documents are rendered by the front end from the node tree, never as
// HTML, so Parse is the single trust boundary: anything it accepts is safe to
// persist and render, and anything outside the allow-list is rejected.
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
)

// ErrInvalid is wrapped by every error Parse returns.
var ErrInvalid = errors.New("invalid rich text")

// Mode selects which nodes a document may contain.
type Mode int

const (
	// Block permits paragraphs, hard breaks and bullet and ordered lists.
	Block Mode = iota
	// Inline permits paragraphs and hard breaks only.
	Inline
)

// Doc is the root of a rich-text document.
type Doc struct {
	Type    string `json:"type"`
	Content []Node `json:"content,omitempty"`
}

// Node is a block or inline node. Only text nodes carry Text and Marks.
type Node struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	Marks   []Mark `json:"marks,omitempty"`
	Content []Node `json:"content,omitempty"`
}

// Mark is a text style. Marks carry no attributes.
type Mark struct {
	Type string `json:"type"`
}

var inlineNodes = map[string]bool{"paragraph": true, "text": true, "hardBreak": true}

var blockOnlyNodes = map[string]bool{"bulletList": true, "orderedList": true, "listItem": true}

var allowedKeys = map[string]bool{"type": true, "text": true, "marks": true, "content": true}

var allowedMarks = map[string]bool{"bold": true, "italic": true, "subscript": true, "superscript": true}

// Parse decodes raw and validates it against mode. It rejects object keys
// other than exactly type, text, marks and content (case-sensitive, no
// duplicates) at every level, unknown nodes and marks, text totalling more than
// 20,000 runes, and nesting deeper than 8 levels below the doc node. Every
// error wraps [ErrInvalid].
//
// The key check keeps Go and JavaScript reading the same bytes the same way:
// encoding/json would otherwise match keys case-insensitively and let the last
// duplicate win. Callers persist json.Marshal of the returned Doc, which is
// canonical, rather than raw.
func Parse(raw []byte, mode Mode) (Doc, error) {
	keys := json.NewDecoder(bytes.NewReader(raw))
	if err := checkKeys(keys); err != nil {
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
	runes := 0
	if err := checkNodes(doc.Content, mode, 1, &runes); err != nil {
		return Doc{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	return doc, nil
}

// checkKeys consumes one JSON value from dec, failing on any object key that is
// not in allowedKeys or that repeats within its object.
func checkKeys(dec *json.Decoder) error {
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
		if delim == '{' {
			kt, err := dec.Token()
			if err != nil {
				return err
			}
			key := kt.(string)
			if !allowedKeys[key] {
				return fmt.Errorf("key %q not allowed", key)
			}
			if seen[key] {
				return fmt.Errorf("duplicate key %q", key)
			}
			seen[key] = true
		}
		if err := checkKeys(dec); err != nil {
			return err
		}
	}
	_, err = dec.Token() // closing delimiter
	return err
}

func checkNodes(nodes []Node, mode Mode, depth int, runes *int) error {
	for _, n := range nodes {
		if depth > maxDepth {
			return fmt.Errorf("nesting deeper than %d", maxDepth)
		}
		if !inlineNodes[n.Type] && (mode != Block || !blockOnlyNodes[n.Type]) {
			return fmt.Errorf("node %q not allowed", n.Type)
		}
		if n.Type == "text" {
			if len(n.Content) > 0 {
				return errors.New("text node has content")
			}
			*runes += utf8.RuneCountInString(n.Text)
			if *runes > maxTextRunes {
				return fmt.Errorf("text longer than %d characters", maxTextRunes)
			}
			for _, m := range n.Marks {
				if !allowedMarks[m.Type] {
					return fmt.Errorf("mark %q not allowed", m.Type)
				}
			}
		} else if n.Text != "" || len(n.Marks) > 0 {
			return fmt.Errorf("%s node has text or marks", n.Type)
		}
		if err := checkNodes(n.Content, mode, depth+1, runes); err != nil {
			return err
		}
	}
	return nil
}

// PlainText returns the document's text with blocks (paragraphs, list items)
// and hard breaks separated by newlines and all formatting dropped.
func (d Doc) PlainText() string {
	return joinBlocks(d.Content)
}

// IsEmpty reports whether the document has no text other than whitespace.
func (d Doc) IsEmpty() bool {
	return strings.TrimSpace(d.PlainText()) == ""
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
	case "paragraph":
		var b strings.Builder
		for _, c := range n.Content {
			b.WriteString(c.plainText())
		}
		return b.String()
	}
	return joinBlocks(n.Content)
}
