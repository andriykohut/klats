package rich

import (
	"errors"
	"strings"
	"testing"
)

func para(inner string) string {
	return `{"type":"doc","content":[{"type":"paragraph","content":[` + inner + `]}]}`
}

func TestParseAcceptsFormattedParagraph(t *testing.T) {
	raw := para(`{"type":"text","text":"H"},{"type":"text","text":"2","marks":[{"type":"subscript"}]},{"type":"text","text":"O"}`)
	doc, err := Parse([]byte(raw), Inline)
	if err != nil {
		t.Fatal(err)
	}
	if got := doc.PlainText(); got != "H2O" {
		t.Fatalf("PlainText = %q, want H2O", got)
	}
}

func TestParseRejectsUnknownNode(t *testing.T) {
	_, err := Parse([]byte(para(`{"type":"image"}`)), Block)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestParseRejectsAttrs(t *testing.T) {
	raw := `{"type":"doc","content":[{"type":"paragraph","attrs":{"onclick":"x"}}]}`
	_, err := Parse([]byte(raw), Block)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestParseRejectsLinkMark(t *testing.T) {
	raw := para(`{"type":"text","text":"x","marks":[{"type":"link"}]}`)
	_, err := Parse([]byte(raw), Block)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestParseRejectsMarkAttrs(t *testing.T) {
	raw := para(`{"type":"text","text":"x","marks":[{"type":"bold","attrs":{"a":1}}]}`)
	_, err := Parse([]byte(raw), Block)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
}

func TestInlineModeRejectsLists(t *testing.T) {
	raw := `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}`
	if _, err := Parse([]byte(raw), Block); err != nil {
		t.Fatalf("Block: %v", err)
	}
	if _, err := Parse([]byte(raw), Inline); !errors.Is(err, ErrInvalid) {
		t.Fatalf("Inline err = %v, want ErrInvalid", err)
	}
}

func TestParseRejectsMalformed(t *testing.T) {
	for name, raw := range map[string]string{
		"not json":      `nope`,
		"trailing data": para(`{"type":"text","text":"x"}`) + `{}`,
		"wrong root":    `{"type":"paragraph"}`,
		"text children": para(`{"type":"text","text":"x","content":[{"type":"text","text":"y"}]}`),
		"empty":         ``,
	} {
		if _, err := Parse([]byte(raw), Block); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}

func TestParseEnforcesTextLimitInRunes(t *testing.T) {
	ok := para(`{"type":"text","text":"` + strings.Repeat("я", 20000) + `"}`)
	if _, err := Parse([]byte(ok), Inline); err != nil {
		t.Fatalf("20000 runes: %v", err)
	}
	split := para(`{"type":"text","text":"` + strings.Repeat("я", 10000) + `"},{"type":"text","text":"` + strings.Repeat("я", 10001) + `"}`)
	if _, err := Parse([]byte(split), Inline); !errors.Is(err, ErrInvalid) {
		t.Fatalf("20001 runes: err = %v, want ErrInvalid", err)
	}
}

func nestedLists(levels int) string {
	// Each level adds bulletList > listItem; the innermost listItem holds a paragraph.
	s := `{"type":"paragraph"}`
	for range levels {
		s = `{"type":"bulletList","content":[{"type":"listItem","content":[` + s + `]}]}`
	}
	return `{"type":"doc","content":[` + s + `]}`
}

func TestParseEnforcesDepthLimit(t *testing.T) {
	// 3 levels: bulletList(1) listItem(2) bulletList(3) listItem(4) bulletList(5) listItem(6) paragraph(7)
	if _, err := Parse([]byte(nestedLists(3)), Block); err != nil {
		t.Fatalf("depth 7: %v", err)
	}
	// 4 levels reach paragraph at depth 9
	if _, err := Parse([]byte(nestedLists(4)), Block); !errors.Is(err, ErrInvalid) {
		t.Fatalf("depth 9: err = %v, want ErrInvalid", err)
	}
	// depth exactly 8: bulletList>listItem x3 then paragraph>text
	exact := strings.Replace(nestedLists(3), `{"type":"paragraph"}`, `{"type":"paragraph","content":[{"type":"text","text":"x"}]}`, 1)
	if _, err := Parse([]byte(exact), Block); err != nil {
		t.Fatalf("depth 8: %v", err)
	}
}

func TestPlainTextJoinsParagraphsWithNewline(t *testing.T) {
	raw := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"а"}]},{"type":"paragraph","content":[{"type":"text","text":"б"}]}]}`
	doc, err := Parse([]byte(raw), Block)
	if err != nil {
		t.Fatal(err)
	}
	if got := doc.PlainText(); got != "а\nб" {
		t.Fatalf("PlainText = %q", got)
	}
}

func TestPlainTextRendersHardBreakAndLists(t *testing.T) {
	raw := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"hardBreak"},{"type":"text","text":"b"}]},` +
		`{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"c"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"d"}]}]}]}]}`
	doc, err := Parse([]byte(raw), Block)
	if err != nil {
		t.Fatal(err)
	}
	if got := doc.PlainText(); got != "a\nb\nc\nd" {
		t.Fatalf("PlainText = %q", got)
	}
}

func TestIsEmptyTreatsWhitespaceAsEmpty(t *testing.T) {
	doc, err := Parse([]byte(para(`{"type":"text","text":" \n "}`)), Block)
	if err != nil {
		t.Fatal(err)
	}
	if !doc.IsEmpty() {
		t.Fatal("whitespace-only doc should be empty")
	}
	doc, err = Parse([]byte(para(`{"type":"text","text":"x"}`)), Block)
	if err != nil {
		t.Fatal(err)
	}
	if doc.IsEmpty() {
		t.Fatal("doc with text should not be empty")
	}
	if !(Doc{Type: "doc"}).IsEmpty() {
		t.Fatal("doc without content should be empty")
	}
}
