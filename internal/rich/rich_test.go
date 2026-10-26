package rich

import (
	"encoding/json"
	"errors"
	"reflect"
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
	// Word's nine list levels reach their paragraph at depth 19.
	if _, err := Parse([]byte(nestedLists(9)), Block); err != nil {
		t.Fatalf("9 list levels: %v", err)
	}
	// A tenth level puts the paragraph at depth 21.
	if _, err := Parse([]byte(nestedLists(10)), Block); !errors.Is(err, ErrInvalid) {
		t.Fatalf("10 list levels: err = %v, want ErrInvalid", err)
	}
	// Nine levels with text in the paragraph reach depth 20 exactly.
	exact := strings.Replace(nestedLists(9), `{"type":"paragraph"}`, `{"type":"paragraph","content":[{"type":"text","text":"x"}]}`, 1)
	if _, err := Parse([]byte(exact), Block); err != nil {
		t.Fatalf("depth 20: %v", err)
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

func TestParseRejectsNonCanonicalKeys(t *testing.T) {
	for name, raw := range map[string]string{
		"case variant on node": `{"type":"doc","content":[{"type":"image","Type":"paragraph"}]}`,
		"case variant on mark": para(`{"type":"text","text":"x","marks":[{"type":"bold","Type":"italic"}]}`),
		"case variant on doc":  `{"type":"doc","Content":[]}`,
		"duplicate type":       `{"type":"doc","content":[{"type":"image","type":"paragraph"}]}`,
		"duplicate on mark":    para(`{"type":"text","text":"x","marks":[{"type":"bold","type":"italic"}]}`),
		"unknown key in mark":  para(`{"type":"text","text":"x","marks":[{"type":"bold","attrs":{}}]}`),
	} {
		if _, err := Parse([]byte(raw), Block); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}

func TestMarshalOfParsedDocRoundTrips(t *testing.T) {
	raw := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"bold"},{"type":"italic"}]},{"type":"hardBreak"}]},` +
		`{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}`
	doc, err := Parse([]byte(raw), Block)
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	again, err := Parse(out, Block)
	if err != nil {
		t.Fatalf("re-parse: %v", err)
	}
	if !reflect.DeepEqual(doc, again) {
		t.Fatalf("round trip changed doc:\n%+v\n%+v", doc, again)
	}
	out2, _ := json.Marshal(again)
	if string(out) != string(out2) {
		t.Fatalf("marshal not stable: %s vs %s", out, out2)
	}
}

func TestParseDropsEmptyTextNodes(t *testing.T) {
	raw := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""},{"type":"text","text":"a"}]},` +
		`{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"","marks":[{"type":"bold"}]}]}]}]}]}`
	doc, err := Parse([]byte(raw), Block)
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},` +
		`{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"}]}]}]}`
	if string(out) != want {
		t.Fatalf("canonical form\n%s\nwant\n%s", out, want)
	}
}

var hex64 = strings.Repeat("ab", 32)

func doc(blocks string) string { return `{"type":"doc","content":[` + blocks + `]}` }

func accepts(t *testing.T, raw string, mode Mode) {
	t.Helper()
	if _, err := Parse([]byte(raw), mode); err != nil {
		t.Errorf("mode %d: %v", mode, err)
	}
}

func rejects(t *testing.T, raw string, mode Mode) {
	t.Helper()
	if _, err := Parse([]byte(raw), mode); !errors.Is(err, ErrInvalid) {
		t.Errorf("mode %d: err = %v, want ErrInvalid: %s", mode, err, raw)
	}
}

func TestParseMath(t *testing.T) {
	ok := para(`{"type":"math","attrs":{"latex":"\\frac12"}}`)
	accepts(t, ok, Inline)
	accepts(t, ok, Block)
	rejects(t, para(`{"type":"math","attrs":{"latex":""}}`), Inline)
	rejects(t, para(`{"type":"math"}`), Inline)
	rejects(t, para(`{"type":"math","attrs":{"latex":"`+strings.Repeat("x", 1001)+`"}}`), Inline)
	accepts(t, para(`{"type":"math","attrs":{"latex":"`+strings.Repeat("x", 1000)+`"}}`), Inline)
	rejects(t, para(`{"type":"math","attrs":{"latex":"x","src":"`+hex64+`.png"}}`), Inline)
	rejects(t, para(`{"type":"math","attrs":{"latex":"x","onclick":"y"}}`), Inline)
	rejects(t, para(`{"type":"math","attrs":{"latex":"x"},"text":"x"}`), Inline)
	rejects(t, para(`{"type":"math","attrs":{"latex":"x"},"content":[{"type":"text","text":"x"}]}`), Inline)
}

func TestParseImageAudio(t *testing.T) {
	img := doc(`{"type":"image","attrs":{"src":"` + hex64 + `.webp","w":800,"h":600}}`)
	accepts(t, img, Block)
	rejects(t, img, Inline)
	accepts(t, doc(`{"type":"audio","attrs":{"src":"`+hex64+`.mp3"}}`), Block)
	for _, src := range []string{hex64 + ".mp3", "../x.png", strings.ToUpper(hex64) + ".png", hex64 + ".svg", hex64[:63] + ".png", "http://x/" + hex64 + ".png"} {
		rejects(t, doc(`{"type":"image","attrs":{"src":"`+src+`","w":8,"h":6}}`), Block)
	}
	rejects(t, doc(`{"type":"audio","attrs":{"src":"`+hex64+`.png"}}`), Block)
	rejects(t, doc(`{"type":"image","attrs":{"src":"`+hex64+`.png"}}`), Block)
	rejects(t, doc(`{"type":"image","attrs":{"src":"`+hex64+`.png","w":10001,"h":6}}`), Block)
	rejects(t, doc(`{"type":"image","attrs":{"src":"`+hex64+`.png","w":8,"h":0}}`), Block)
	rejects(t, doc(`{"type":"audio","attrs":{"src":"`+hex64+`.mp3","w":8}}`), Block)
	rejects(t, doc(`{"type":"image"}`), Block)
}

func TestParseGapOnlyInGapped(t *testing.T) {
	g1 := para(`{"type":"gap","attrs":{"id":"g1"}}`)
	rejects(t, g1, Block)
	rejects(t, g1, Inline)
	accepts(t, g1, Gapped)
	rejects(t, para(`{"type":"gap","attrs":{"id":"g1"}},{"type":"gap","attrs":{"id":"g1"}}`), Gapped)
	accepts(t, para(`{"type":"gap","attrs":{"id":"g1"}},{"type":"gap","attrs":{"id":"g2"}}`), Gapped)
	rejects(t, para(`{"type":"gap","attrs":{"id":"a b"}}`), Gapped)
	rejects(t, para(`{"type":"gap","attrs":{"id":""}}`), Gapped)
	rejects(t, para(`{"type":"gap","attrs":{"id":"`+strings.Repeat("a", 33)+`"}}`), Gapped)
	accepts(t, para(`{"type":"gap","attrs":{"id":"`+strings.Repeat("a", 32)+`"}}`), Gapped)
	rejects(t, para(`{"type":"gap"}`), Gapped)
	accepts(t, para(`{"type":"math","attrs":{"latex":"x"}}`), Gapped)
}

func TestParseTargetOnlyInMarked(t *testing.T) {
	target := para(`{"type":"text","text":"x","marks":[{"type":"target"}]}`)
	accepts(t, target, Marked)
	rejects(t, target, Block)
	rejects(t, target, Inline)
	rejects(t, target, Gapped)
	rejects(t, para(`{"type":"math","attrs":{"latex":"x"}}`), Marked)
	accepts(t, para(`{"type":"text","text":"x","marks":[{"type":"bold"}]}`), Marked)
}

func TestParseTableAndCode(t *testing.T) {
	cell := func(typ, text string) string {
		return `{"type":"` + typ + `","content":[{"type":"paragraph","content":[{"type":"text","text":"` + text + `"}]}]}`
	}
	table := doc(`{"type":"table","content":[` +
		`{"type":"tableRow","content":[` + cell("tableHeader", "a") + `,` + cell("tableHeader", "b") + `]},` +
		`{"type":"tableRow","content":[` + cell("tableCell", "c") + `,{"type":"tableCell","attrs":{"colspan":2,"rowspan":1},"content":[{"type":"paragraph"}]}]}]}`)
	accepts(t, table, Block)
	rejects(t, table, Inline)
	rejects(t, doc(`{"type":"table","content":[{"type":"paragraph"}]}`), Block)
	rejects(t, doc(`{"type":"table","content":[{"type":"tableRow","content":[{"type":"paragraph"}]}]}`), Block)
	rejects(t, doc(`{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"bulletList"}]}]}]}`), Block)
	rejects(t, doc(`{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":21},"content":[{"type":"paragraph"}]}]}]}`), Block)
	rejects(t, doc(`{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"src":"x"},"content":[{"type":"paragraph"}]}]}]}`), Block)

	code := func(inner string) string { return doc(`{"type":"codeBlock","content":[` + inner + `]}`) }
	accepts(t, code(`{"type":"text","text":"x := 1\ny := 2"}`), Block)
	rejects(t, code(`{"type":"text","text":"x","marks":[{"type":"bold"}]}`), Block)
	rejects(t, code(`{"type":"hardBreak"}`), Block)
	rejects(t, code(`{"type":"paragraph"}`), Block)
	rejects(t, code(`{"type":"text","text":"x"}`), Inline)
	accepts(t, para(`{"type":"text","text":"x","marks":[{"type":"code"}]}`), Inline)
}

func TestParseCodeLanguage(t *testing.T) {
	code := func(attrs string) string {
		return doc(`{"type":"codeBlock",` + attrs + `"content":[{"type":"text","text":"x"}]}`)
	}
	for _, l := range []string{"python", "cpp", "pascal", "javascript", "html", "css"} {
		accepts(t, code(`"attrs":{"language":"`+l+`"},`), Block)
	}
	accepts(t, code(""), Block)
	rejects(t, code(`"attrs":{"language":"ruby"},`), Block)
	rejects(t, code(`"attrs":{"language":""},`), Block)
	rejects(t, code(`"attrs":{"language":"python","src":"x"},`), Block)
	rejects(t, doc(`{"type":"paragraph","attrs":{"language":"python"}}`), Block)
}

func TestPlainTextNewNodes(t *testing.T) {
	parse := func(raw string, mode Mode) Doc {
		t.Helper()
		d, err := Parse([]byte(raw), mode)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	if got := parse(para(`{"type":"text","text":"x = "},{"type":"math","attrs":{"latex":"\\pi"}}`), Inline).PlainText(); got != `x = \pi` {
		t.Errorf("math: %q", got)
	}
	if got := parse(para(`{"type":"gap","attrs":{"id":"g"}}`), Gapped).PlainText(); got != "___" {
		t.Errorf("gap: %q", got)
	}
	row := func(a, b string) string {
		c := func(s string) string {
			return `{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"` + s + `"}]}]}`
		}
		return `{"type":"tableRow","content":[` + c(a) + `,` + c(b) + `]}`
	}
	table := doc(`{"type":"table","content":[` + row("а", "б") + `,` + row("в", "г") + `]}`)
	if got := parse(table, Block).PlainText(); got != "а\tб\nв\tг" {
		t.Errorf("table: %q", got)
	}
	img := doc(`{"type":"image","attrs":{"src":"` + hex64 + `.png","w":1,"h":1}}`)
	if got := parse(img, Block).PlainText(); got != "" {
		t.Errorf("image: %q", got)
	}
	code := doc(`{"type":"codeBlock","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}`)
	if got := parse(code, Block).PlainText(); got != "ab" {
		t.Errorf("code: %q", got)
	}
}

func TestIsEmptyWithMediaAndMath(t *testing.T) {
	for name, raw := range map[string]string{
		"image": doc(`{"type":"image","attrs":{"src":"` + hex64 + `.png","w":1,"h":1}}`),
		"audio": doc(`{"type":"audio","attrs":{"src":"` + hex64 + `.mp3"}}`),
		"math":  para(`{"type":"math","attrs":{"latex":"x"}}`),
	} {
		d, err := Parse([]byte(raw), Block)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if d.IsEmpty() {
			t.Errorf("%s: doc should not be empty", name)
		}
	}
}

func TestMediaAndGapIDs(t *testing.T) {
	img, mp3 := hex64+".png", strings.Repeat("cd", 32)+".mp3"
	d, err := Parse([]byte(doc(
		`{"type":"image","attrs":{"src":"`+img+`","w":1,"h":1}},`+
			`{"type":"audio","attrs":{"src":"`+mp3+`"}},`+
			`{"type":"image","attrs":{"src":"`+img+`","w":2,"h":2}}`)), Block)
	if err != nil {
		t.Fatal(err)
	}
	if got := d.Media(); !reflect.DeepEqual(got, []string{img, mp3}) {
		t.Errorf("Media = %v", got)
	}
	g, err := Parse([]byte(para(`{"type":"gap","attrs":{"id":"g2"}},{"type":"text","text":"x"},{"type":"gap","attrs":{"id":"g1"}}`)), Gapped)
	if err != nil {
		t.Fatal(err)
	}
	if got := g.GapIDs(); !reflect.DeepEqual(got, []string{"g2", "g1"}) {
		t.Errorf("GapIDs = %v", got)
	}
}

func TestMediaKind(t *testing.T) {
	for name, want := range map[string]string{
		hex64 + ".jpg": "image", hex64 + ".png": "image", hex64 + ".gif": "image", hex64 + ".webp": "image",
		hex64 + ".mp3": "audio", hex64 + ".m4a": "audio", hex64 + ".ogg": "audio", hex64 + ".wav": "audio",
		"": "", hex64: "", hex64 + ".svg": "", hex64 + ".PNG": "", "x.png": "", "/" + hex64 + ".png": "",
	} {
		if got := MediaKind(name); got != want {
			t.Errorf("MediaKind(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestParseRejectsEmptyAttrsOnPlainNodes(t *testing.T) {
	for name, raw := range map[string]string{
		"paragraph":      `{"type":"doc","content":[{"type":"paragraph","attrs":{}}]}`,
		"paragraph zero": `{"type":"doc","content":[{"type":"paragraph","attrs":{"colspan":0}}]}`,
		"text":           para(`{"type":"text","text":"x","attrs":{"src":null}}`),
		"listItem":       `{"type":"doc","content":[{"type":"bulletList","attrs":{},"content":[{"type":"listItem","attrs":{}}]}]}`,
		"hardBreak":      para(`{"type":"hardBreak","attrs":{}}`),
		"codeBlock":      doc(`{"type":"codeBlock","attrs":{}}`),
		"table":          doc(`{"type":"table","attrs":{}}`),
	} {
		t.Run(name, func(t *testing.T) { rejects(t, raw, Block) })
	}
}

func TestParseRoundTripsAttrs(t *testing.T) {
	raw := doc(`{"type":"image","attrs":{"src":"` + hex64 + `.png","w":8,"h":6}},` +
		`{"type":"paragraph","content":[{"type":"math","attrs":{"latex":"x"}}]}`)
	d, err := Parse([]byte(raw), Block)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(d)
	if string(out) != raw {
		t.Fatalf("got %s\nwant %s", out, raw)
	}
}

func TestParseContentModel(t *testing.T) {
	img := `{"type":"image","attrs":{"src":"` + hex64 + `.png","w":8,"h":6}}`
	audio := `{"type":"audio","attrs":{"src":"` + hex64 + `.mp3"}}`
	row := `{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph"}]}]}`
	item := func(inner string) string { return `{"type":"listItem","content":[` + inner + `]}` }

	for name, raw := range map[string]string{
		"paragraph > image": para(img),
		"paragraph > table": para(`{"type":"table","content":[` + row + `]}`),
		"doc > tableRow":    doc(row),
		"doc > tableCell":   doc(`{"type":"tableCell","content":[{"type":"paragraph"}]}`),
		"doc > text":        doc(`{"type":"text","text":"x"}`),
		"doc > hardBreak":   doc(`{"type":"hardBreak"}`),
		"doc > math":        doc(`{"type":"math","attrs":{"latex":"x"}}`),
		"doc > listItem":    doc(item(`{"type":"paragraph"}`)),
		"empty table":       doc(`{"type":"table"}`),
		"empty tableRow":    doc(`{"type":"table","content":[{"type":"tableRow"}]}`),
		"bulletList > para": doc(`{"type":"bulletList","content":[{"type":"paragraph"}]}`),
		"cell > image":      doc(`{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[` + img + `]}]}]}`),
		"listItem > text":   doc(`{"type":"bulletList","content":[` + item(`{"type":"text","text":"x"}`) + `]}`),
	} {
		t.Run(name, func(t *testing.T) { rejects(t, raw, Block) })
	}
	rejects(t, doc(`{"type":"gap","attrs":{"id":"g"}}`), Gapped)

	accepts(t, doc(`{"type":"bulletList","content":[`+item(`{"type":"paragraph"},`+img+`,`+audio)+`]}`), Block)
	accepts(t, doc(`{"type":"orderedList","content":[`+item(`{"type":"paragraph"},{"type":"table","content":[`+row+`]}`)+`]}`), Block)
	accepts(t, doc(`{"type":"paragraph","content":[{"type":"hardBreak"},{"type":"math","attrs":{"latex":"x"}}]},`+img+`,`+audio), Block)
}
