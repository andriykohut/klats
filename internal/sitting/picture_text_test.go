package sitting

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"

	"klats/internal/events"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
)

var picture = &testfmt.Image{Src: strings.Repeat("c", 64) + ".png", W: 800, H: 600}

// highlightBody is a paragraph of the words «Кіт біжить додому швидко», with
// «біжить» and «швидко» marked.
const highlightBody = `{"type":"doc","content":[{"type":"paragraph","content":[` +
	`{"type":"text","text":"Кіт "},{"type":"text","text":"біжить","marks":[{"type":"target"}]},` +
	`{"type":"text","text":" додому "},{"type":"text","text":"швидко","marks":[{"type":"bold"},{"type":"target"}]}]}]}`

// pictureTextQuestions returns a hotspot q1, a label question q2 (points p1,
// p2; labels l0..l5 with l0 on p1, l1 on p2, the rest decoys), a highlight q3
// and a written answer q4 worth 4 points.
func pictureTextQuestions() []testfmt.Question {
	labels := make([]testfmt.Option, 6)
	for i := range labels {
		labels[i] = testfmt.Option{ID: fmt.Sprintf("l%d", i), Content: rich(fmt.Sprintf("підпис %d", i))}
	}
	labels[0].Target, labels[1].Target = "p1", "p2"
	return []testfmt.Question{
		{ID: "q1", Type: "hotspot", Text: rich("Де серце?"), Points: 1, Image: picture,
			Areas: []testfmt.Area{{ID: "a1", Shape: "ellipse", X: 0.4, Y: 0.4, W: 0.2, H: 0.2}}},
		{ID: "q2", Type: "label", Text: rich("Підпишіть"), Points: 2, Partial: true, Image: picture, Options: labels,
			Targets: []testfmt.Target{{ID: "p1", X: 0.2, Y: 0.3}, {ID: "p2", X: 0.7, Y: 0.8}}},
		{ID: "q3", Type: "highlight", Points: 2, Partial: true, Body: json.RawMessage(highlightBody)},
		{ID: "q4", Type: "open", Text: rich("Поясніть"), Points: 4, Rubric: "ключова думка"},
	}
}

func decodeTest(t *testing.T, qs []testfmt.Question) testfmt.Test {
	t.Helper()
	raw, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Типи", Palette: "teal", Questions: qs})
	if err != nil {
		t.Fatal(err)
	}
	tst, err := testfmt.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tst
}

// setupQuestions returns an engine over a database holding test "t1" of the
// questions.
func setupQuestions(t *testing.T, qs []testfmt.Question) (*Engine, *store.Store) {
	t.Helper()
	st := openStore(t)
	doc, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Типи", Palette: "teal", Questions: qs})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t1", Title: "Типи", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
	return newEngine(t, st, events.New()), st
}

func TestStudentPayloadPictureText(t *testing.T) {
	tst := decodeTest(t, pictureTextQuestions())
	st := studentTest(tst, "dev1")
	raw, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{`"areas"`, `"target"`, `"rubric"`, `"correct"`, "ключова"} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("payload carries %s: %s", leak, raw)
		}
	}

	hotspot, label, highlight, open := st.Questions[0], st.Questions[1], st.Questions[2], st.Questions[3]
	if hotspot.Image == nil || *hotspot.Image != *picture || len(hotspot.Options) != 0 {
		t.Errorf("hotspot = %+v", hotspot)
	}

	if label.Image == nil || len(label.Targets) != 2 || label.Targets[0].X != 0.2 || label.Targets[0].Y != 0.3 || label.Targets[1].X != 0.7 {
		t.Errorf("label = %+v", label)
	}
	key := []string{"l0", "l1", "l2", "l3", "l4", "l5"}
	shuffled := false
	for d := range 20 {
		got := optionIDs(studentTest(tst, fmt.Sprintf("dev%d", d)).Questions[1])
		if !slices.Equal(slices.Sorted(slices.Values(got)), key) {
			t.Fatalf("labels = %v", got)
		}
		shuffled = shuffled || !slices.Equal(got, key)
	}
	if !shuffled {
		t.Error("labels should be shuffled")
	}
	if !slices.Equal(optionIDs(studentTest(tst, "dev1").Questions[1]), optionIDs(label)) {
		t.Error("the label shuffle must be fixed per device")
	}

	if !strings.Contains(string(highlight.Body), `"type":"word"`) || strings.Count(string(highlight.Body), `"type":"word"`) != 4 {
		t.Errorf("highlight body = %s", highlight.Body)
	}
	if !strings.Contains(string(highlight.Body), `"bold"`) {
		t.Errorf("highlight body lost its formatting: %s", highlight.Body)
	}

	if len(open.Options) != 0 || open.Body != nil || open.Image != nil {
		t.Errorf("open sends more than its text: %+v", open)
	}
}

func TestFinishResultPending(t *testing.T) {
	e, _ := setupQuestions(t, pictureTextQuestions())
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	submit(t, e, devA,
		typedChange(p, "q1", 1, testfmt.Answer{Point: &testfmt.Point{X: 0.5, Y: 0.5}}),
		typedChange(p, "q4", 1, testfmt.Answer{Text: "Бо так написано в підручнику"}),
	)
	r := finish(t, e, devA)
	if !r.Pending || r.Correct != 1 {
		t.Errorf("finish = %+v, want pending", r)
	}
	if row := liveOf(t, e).Rows[0]; !slices.Equal(row.Cells, []string{"correct", "empty", "empty", "pending"}) || row.Pending != 1 {
		t.Errorf("live row = %+v", row)
	}
	if l := liveOf(t, e); l.QuestionPct[3] != nil {
		t.Errorf("a pending answer counts in the percent: %v", *l.QuestionPct[3])
	}
	if row := resultsOf(t, e, info.AssignmentID).Rows[0]; row.Pending != 1 {
		t.Errorf("results row = %+v", row)
	}

	three := 3.0
	if err := e.SetOverride(info.AssignmentID, p.ID, "q4", &three); err != nil {
		t.Fatal(err)
	}
	s := heartbeat(t, e, devA, 0)
	// 1 + 3 of 9 points.
	if s.Result == nil || s.Result.Pending || s.Result.Grade != 5 {
		t.Errorf("status after the override = %+v, want grade 5", s.Result)
	}
	if row := liveOf(t, e).Rows[0]; row.Cells[3] != "wrong" || row.Pending != 0 {
		t.Errorf("live row after the override = %+v", row)
	}
	if row := resultsOf(t, e, info.AssignmentID).Rows[0]; row.Pending != 0 || row.Points[3] != 3 {
		t.Errorf("results row after the override = %+v", row)
	}
}

func TestResultsHighlightWords(t *testing.T) {
	e, _ := setupQuestions(t, pictureTextQuestions())
	info := start(t, e, nil)
	p := enter(t, e, info.Code, devA, "Шевченко")
	submit(t, e, devA, typedChange(p, "q3", 1, testfmt.Answer{Items: []string{"1", "2"}}))

	res := resultsOf(t, e, info.AssignmentID)
	hl := res.Questions[2]
	if !slices.Equal(hl.TargetWords, []string{"1", "3"}) || !strings.Contains(string(hl.Words), `"type":"word"`) || strings.Contains(string(hl.Words), "target") {
		t.Errorf("highlight result = %+v, words %s", hl, hl.Words)
	}
	if res.Questions[0].Words != nil || res.Questions[0].TargetWords != nil {
		t.Errorf("hotspot result has words: %+v", res.Questions[0])
	}
	if want := map[string]bool{"1": true, "2": false}; !maps.Equal(res.Rows[0].Verdicts["q3"], want) {
		t.Errorf("verdicts = %v", res.Rows[0].Verdicts["q3"])
	}
}
