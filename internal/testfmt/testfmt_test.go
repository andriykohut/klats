package testfmt

import (
	"bytes"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func richText(s string) string {
	if s == "" {
		return `{"type":"doc","content":[{"type":"paragraph"}]}`
	}
	return fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}`, s)
}

type opt struct {
	text    string
	correct bool
}

func testJSON(palette, qtype string, points int, partial bool, text string, opts ...opt) []byte {
	var os []string
	for i, o := range opts {
		os = append(os, fmt.Sprintf(`{"id":"o%d","content":%s,"correct":%t}`, i, richText(o.text), o.correct))
	}
	return []byte(fmt.Sprintf(
		`{"id":"t1","version":1,"title":"T","palette":%q,"questions":[{"id":"q1","type":%q,"text":%s,"points":%d,"shuffleOptions":false,"partial":%t,"options":[%s]}]}`,
		palette, qtype, richText(text), points, partial, strings.Join(os, ",")))
}

func decode(t *testing.T, raw []byte) Test {
	t.Helper()
	tst, err := Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tst
}

func codes(ps []Problem) []string {
	var out []string
	for _, p := range ps {
		out = append(out, p.Code)
	}
	return out
}

func wantCodes(t *testing.T, tst Test, want ...string) []Problem {
	t.Helper()
	ps := tst.Problems()
	got := codes(ps)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("codes = %v, want %v", got, want)
	}
	return ps
}

func TestProblems(t *testing.T) {
	for name, c := range map[string]struct {
		raw  []byte
		want []Problem
	}{
		"valid":      {testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false}), nil},
		"no text":    {testJSON("teal", "single", 1, false, "", opt{"a", true}, opt{"b", false}), []Problem{{"q1", "no_text", "error", 0}}},
		"no correct": {testJSON("teal", "single", 1, false, "Q", opt{"a", false}, opt{"b", false}), []Problem{{"q1", "no_correct", "error", 0}}},
		"one option": {testJSON("teal", "single", 1, false, "Q", opt{"a", true}), []Problem{{"q1", "too_few_options", "error", 2}}},
		// The student can pick only one option, and scoring needs every correct
		// one, so nobody could score: the start is blocked.
		"single, two correct":  {testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", true}, opt{"c", false}), []Problem{{"q1", "single_many_correct", "error", 2}}},
		"empty option":         {testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"", false}), []Problem{{"q1", "empty_option", "warning", 0}}},
		"weak partial":         {testJSON("teal", "multi", 1, true, "Q", opt{"a", true}, opt{"b", true}, opt{"c", false}), []Problem{{"q1", "weak_partial", "warning", 0}}},
		"partial, one correct": {testJSON("teal", "multi", 1, true, "Q", opt{"a", true}, opt{"b", false}, opt{"c", false}), nil},
		"in order": {testJSON("teal", "single", 1, false, "", opt{"", false}), []Problem{
			{"q1", "no_text", "error", 0}, {"q1", "no_correct", "error", 0}, {"q1", "too_few_options", "error", 2}, {"q1", "empty_option", "warning", 0},
		}},
	} {
		if got := decode(t, c.raw).Problems(); !slices.Equal(got, c.want) {
			t.Errorf("%s: problems = %+v, want %+v", name, got, c.want)
		}
	}
}

func TestHasBlockingOnlyForErrors(t *testing.T) {
	weak := decode(t, testJSON("teal", "multi", 1, true, "Q", opt{"a", true}, opt{"b", true}, opt{"c", false}))
	if weak.HasBlocking() {
		t.Fatal("warning-only test must not block")
	}
	bad := decode(t, testJSON("teal", "single", 1, false, "", opt{"a", true}, opt{"b", false}))
	if !bad.HasBlocking() {
		t.Fatal("no_text must block")
	}
}

func TestDecodeRejects(t *testing.T) {
	valid := string(testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false}))
	for name, raw := range map[string][]byte{
		"unknown palette":   testJSON("pink", "single", 1, false, "Q", opt{"a", true}, opt{"b", false}),
		"0 points":          testJSON("teal", "single", 0, false, "Q", opt{"a", true}, opt{"b", false}),
		"13 points":         testJSON("teal", "single", 13, false, "Q", opt{"a", true}, opt{"b", false}),
		"unknown type":      testJSON("teal", "essay", 1, false, "Q", opt{"a", true}, opt{"b", false}),
		"invalid rich text": []byte(strings.Replace(valid, `"type":"paragraph"`, `"type":"image"`, 1)),
	} {
		if _, err := Decode(raw); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
}

func TestDecodeRejectsNewerVersion(t *testing.T) {
	raw := bytes.Replace(testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false}), []byte(`"version":1`), []byte(`"version":2`), 1)
	if _, err := Decode(raw); !errors.Is(err, ErrTooNew) {
		t.Fatalf("err = %v, want ErrTooNew", err)
	}
}

func TestDecodeDefaultsPaletteTeal(t *testing.T) {
	if got := decode(t, testJSON("", "single", 1, false, "Q", opt{"a", true}, opt{"b", false})).Palette; got != "teal" {
		t.Fatalf("palette = %q", got)
	}
}

func TestDecodeCanonicalizesRichFields(t *testing.T) {
	raw := strings.Replace(string(testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false})),
		`{"type":"doc","content"`, `{ "type": "doc", "content"`, 1)
	tst := decode(t, []byte(raw))
	want := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Q"}]}]}`
	if got := string(tst.Questions[0].Text); got != want {
		t.Fatalf("text = %s, want %s", got, want)
	}
}

const emptyDocJSON = `{"type":"doc","content":[]}`

func TestDecodeMissingOrNullTextIsEmpty(t *testing.T) {
	base := string(testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false}))
	withText := `"text":` + richText("Q") + `,`
	for name, repl := range map[string]string{"omitted": "", "null": `"text":null,`} {
		tst := decode(t, []byte(strings.Replace(base, withText, repl, 1)))
		if got := string(tst.Questions[0].Text); got != emptyDocJSON {
			t.Fatalf("%s: text = %s", name, got)
		}
		wantCodes(t, tst, "no_text")
	}
}

func TestDecodeMissingOptionContentIsEmpty(t *testing.T) {
	base := string(testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false}))
	tst := decode(t, []byte(strings.Replace(base, `"content":`+richText("b")+`,`, "", 1)))
	if got := string(tst.Questions[0].Options[1].Content); got != emptyDocJSON {
		t.Fatalf("content = %s", got)
	}
	wantCodes(t, tst, "empty_option")
}
