package testfmt

import (
	"encoding/json"
	"fmt"
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

func TestValidQuestionHasNoProblems(t *testing.T) {
	wantCodes(t, decode(t, testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false})))
}

func TestNoText(t *testing.T) {
	ps := wantCodes(t, decode(t, testJSON("teal", "single", 1, false, "", opt{"a", true}, opt{"b", false})), "no_text")
	if ps[0].Severity != "error" || ps[0].QuestionID != "q1" {
		t.Fatalf("problem = %+v", ps[0])
	}
}

func TestNoCorrect(t *testing.T) {
	ps := wantCodes(t, decode(t, testJSON("teal", "single", 1, false, "Q", opt{"a", false}, opt{"b", false})), "no_correct")
	if ps[0].Severity != "error" {
		t.Fatalf("severity = %s", ps[0].Severity)
	}
}

func TestTooFewOptions(t *testing.T) {
	ps := wantCodes(t, decode(t, testJSON("teal", "single", 1, false, "Q", opt{"a", true})), "too_few_options")
	if ps[0].Severity != "error" {
		t.Fatalf("severity = %s", ps[0].Severity)
	}
}

func TestSingleManyCorrect(t *testing.T) {
	ps := wantCodes(t, decode(t, testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", true}, opt{"c", false})), "single_many_correct")
	if ps[0].Severity != "warning" || ps[0].Count != 2 {
		t.Fatalf("problem = %+v", ps[0])
	}
}

func TestEmptyOption(t *testing.T) {
	ps := wantCodes(t, decode(t, testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"", false})), "empty_option")
	if ps[0].Severity != "warning" {
		t.Fatalf("severity = %s", ps[0].Severity)
	}
}

func TestWeakPartial(t *testing.T) {
	ps := wantCodes(t, decode(t, testJSON("teal", "multi", 1, true, "Q", opt{"a", true}, opt{"b", true}, opt{"c", false})), "weak_partial")
	if ps[0].Severity != "warning" {
		t.Fatalf("severity = %s", ps[0].Severity)
	}
	wantCodes(t, decode(t, testJSON("teal", "multi", 1, true, "Q", opt{"a", true}, opt{"b", false}, opt{"c", false})))
}

func TestProblemsOrder(t *testing.T) {
	wantCodes(t, decode(t, testJSON("teal", "single", 1, false, "", opt{"", false})),
		"no_text", "no_correct", "too_few_options", "empty_option")
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

func TestDecodeRejectsUnknownPalette(t *testing.T) {
	if _, err := Decode(testJSON("pink", "single", 1, false, "Q", opt{"a", true}, opt{"b", false})); err == nil {
		t.Fatal("want error")
	}
}

func TestDecodeDefaultsPaletteTeal(t *testing.T) {
	if got := decode(t, testJSON("", "single", 1, false, "Q", opt{"a", true}, opt{"b", false})).Palette; got != "teal" {
		t.Fatalf("palette = %q", got)
	}
}

func TestDecodeRejectsPointsOutOfRange(t *testing.T) {
	for _, p := range []int{0, 13} {
		if _, err := Decode(testJSON("teal", "single", p, false, "Q", opt{"a", true}, opt{"b", false})); err == nil {
			t.Fatalf("points %d: want error", p)
		}
	}
}

func TestDecodeRejectsUnknownType(t *testing.T) {
	if _, err := Decode(testJSON("teal", "essay", 1, false, "Q", opt{"a", true}, opt{"b", false})); err == nil {
		t.Fatal("want error")
	}
}

func TestDecodeRejectsInvalidRich(t *testing.T) {
	raw := strings.Replace(string(testJSON("teal", "single", 1, false, "Q", opt{"a", true}, opt{"b", false})),
		`"type":"paragraph"`, `"type":"image"`, 1)
	if _, err := Decode([]byte(raw)); err == nil {
		t.Fatal("want error")
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

func TestProblemJSONOmitsZeroCount(t *testing.T) {
	b, _ := json.Marshal(Problem{QuestionID: "q", Code: "no_text", Severity: "error"})
	if string(b) != `{"questionId":"q","code":"no_text","severity":"error"}` {
		t.Fatalf("json = %s", b)
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
