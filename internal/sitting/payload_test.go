package sitting

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"klats/internal/testfmt"
	"klats/internal/wire"
)

func typedPayloadTest(t *testing.T) testfmt.Test {
	t.Helper()
	body := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"gap","attrs":{"id":"g1"}},{"type":"gap","attrs":{"id":"g2"}}]}]}`
	var choices []testfmt.Choice
	for i := range 12 {
		choices = append(choices, testfmt.Choice{ID: fmt.Sprintf("c%d", i), Text: fmt.Sprint(i), Correct: i == 3})
	}
	raw, err := json.Marshal(testfmt.Test{ID: "t", Version: 1, Title: "T", Questions: []testfmt.Question{
		{ID: "q1", Type: "gaps", Points: 2, Body: json.RawMessage(body), Match: &testfmt.Match{AllowTypo: true}, Gaps: []testfmt.Gap{
			{ID: "g2", Choices: choices},
			{ID: "g1", Accepted: []string{"secret"}},
		}},
		{ID: "q2", Type: "short", Points: 1, Accepted: []string{"secret"}, Match: &testfmt.Match{}},
		{ID: "q3", Type: "number", Points: 1, Number: &testfmt.NumberKey{Mode: "exact", Value: 4242}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	tst, err := testfmt.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	return tst
}

func choiceIDs(g wire.StudentGap) []string {
	var ids []string
	for _, c := range g.Choices {
		ids = append(ids, c.ID)
	}
	return ids
}

func TestStudentPayloadGaps(t *testing.T) {
	tst := typedPayloadTest(t)
	st := studentTest(tst, "dev1")
	raw, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{`"accepted":`, `"correct":`, `"match":`, `"number":`, "secret", "4242"} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("payload carries %s: %s", leak, raw)
		}
	}

	q := st.Questions[0]
	if string(q.Body) != string(tst.Questions[0].Body) {
		t.Errorf("body changed: %s", q.Body)
	}
	if len(q.Gaps) != 2 || q.Gaps[0].ID != "g1" || q.Gaps[1].ID != "g2" {
		t.Fatalf("gaps = %+v, want g1, g2 in body order", q.Gaps)
	}
	if q.Gaps[0].Choices != nil {
		t.Errorf("a typed gap has choices: %+v", q.Gaps[0].Choices)
	}

	var key []string
	for _, c := range tst.Questions[0].Gaps[1].Choices {
		key = append(key, c.ID)
	}
	got := choiceIDs(q.Gaps[1])
	if slices.Equal(got, key) || !slices.Equal(slices.Sorted(slices.Values(got)), slices.Sorted(slices.Values(key))) {
		t.Errorf("choices should be a shuffle of %v, got %v", key, got)
	}
	if !slices.Equal(choiceIDs(studentTest(tst, "dev1").Questions[0].Gaps[1]), got) {
		t.Error("the shuffle must be fixed per device")
	}
	if slices.Equal(choiceIDs(studentTest(tst, "dev2").Questions[0].Gaps[1]), got) {
		t.Error("another device should get another order")
	}
}

func TestStudentPayloadTextOnlyTypes(t *testing.T) {
	st := studentTest(typedPayloadTest(t), "dev1")
	for _, q := range st.Questions[1:] {
		if len(q.Options) != 0 || q.Body != nil || q.Gaps != nil || q.Targets != nil {
			t.Errorf("%s sends more than its text: %+v", q.ID, q)
		}
	}
}
