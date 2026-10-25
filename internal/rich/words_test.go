package rich

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func wordTexts(words []Word) []string {
	var out []string
	for _, w := range words {
		out = append(out, w.Text)
	}
	return out
}

// TestWords pins the word rule with the sample sentence the student app's
// preview tokenizer is checked against.
func TestWords(t *testing.T) {
	d, err := Parse([]byte(para(
		`{"type":"text","text":"Кіт "},`+
			`{"type":"text","text":"біж","marks":[{"type":"bold"},{"type":"target"}]},`+
			`{"type":"text","text":"ить, м’ята й пів-яблука."}`)), Marked)
	if err != nil {
		t.Fatal(err)
	}
	out, words := d.Words()
	if got, want := wordTexts(words), []string{"Кіт", "біжить", "м’ята", "й", "пів-яблука"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("words = %q, want %q", got, want)
	}
	for i, w := range words {
		if w.Target != (i == 1) {
			t.Errorf("words[%d].Target = %v", i, w.Target)
		}
	}

	p := out.Content[0].Content
	var types []string
	for _, n := range p {
		types = append(types, n.Type)
	}
	if want := "word text word text word text word text word text"; strings.Join(types, " ") != want {
		t.Fatalf("paragraph nodes = %v", types)
	}
	bold := []Mark{{Type: "bold"}}
	if want := []Node{{Type: "text", Text: "біж", Marks: bold}, {Type: "text", Text: "ить"}}; !reflect.DeepEqual(p[2].Content, want) {
		t.Errorf("біжить = %+v, want two runs", p[2].Content)
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "target") {
		t.Errorf("the target mark is kept: %s", raw)
	}
	if orig := d.Content[0].Content; len(orig) != 3 || len(orig[1].Marks) != 2 {
		t.Errorf("Words changed the document it was called on: %+v", orig)
	}
}

func TestWordsSplitting(t *testing.T) {
	for _, c := range []struct {
		inline string
		want   []string
	}{
		{`{"type":"text","text":"'так' — ні--так -а б-"}`, []string{"так", "ні", "так", "а", "б"}},
		{`{"type":"text","text":"x²+5 café 2026р."}`, []string{"x", "5", "café", "2026р"}},
		{`{"type":"text","text":"раз"},{"type":"hardBreak"},{"type":"text","text":"два"}`, []string{"раз", "два"}},
	} {
		d, err := Parse([]byte(para(c.inline)), Marked)
		if err != nil {
			t.Fatal(err)
		}
		if _, words := d.Words(); !reflect.DeepEqual(wordTexts(words), c.want) {
			t.Errorf("%s: words = %q, want %q", c.inline, wordTexts(words), c.want)
		}
	}
	d, err := Parse([]byte(doc(`{"type":"paragraph","content":[{"type":"text","text":"раз"}]},{"type":"paragraph","content":[{"type":"text","text":"два"}]}`)), Marked)
	if err != nil {
		t.Fatal(err)
	}
	if _, words := d.Words(); !reflect.DeepEqual(wordTexts(words), []string{"раз", "два"}) {
		t.Errorf("two paragraphs: %q", wordTexts(words))
	}
}

func TestParseRejectsWordNode(t *testing.T) {
	word := para(`{"type":"word","content":[{"type":"text","text":"x"}]}`)
	for _, mode := range []Mode{Block, Inline, Gapped, Marked} {
		rejects(t, word, mode)
	}
}
