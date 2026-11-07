package sitting

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
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
		{ID: "q2", Type: "short", Points: 1, Accepted: []string{"secret"}, Match: &testfmt.Match{}, Tags: []string{"прихований-тег"}},
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
	st := studentTest(tst, tst.Questions, "dev1")
	raw, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{`"accepted":`, `"correct":`, `"match":`, `"number":`, "secret", "4242", "прихований-тег"} {
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
	if !slices.Equal(choiceIDs(studentTest(tst, tst.Questions, "dev1").Questions[0].Gaps[1]), got) {
		t.Error("the shuffle must be fixed per device")
	}
	if slices.Equal(choiceIDs(studentTest(tst, tst.Questions, "dev2").Questions[0].Gaps[1]), got) {
		t.Error("another device should get another order")
	}
}

func TestStudentPayloadTextOnlyTypes(t *testing.T) {
	tst := typedPayloadTest(t)
	st := studentTest(tst, tst.Questions, "dev1")
	for _, q := range st.Questions[1:] {
		if len(q.Options) != 0 || q.Body != nil || q.Gaps != nil || q.Targets != nil {
			t.Errorf("%s sends more than its text: %+v", q.ID, q)
		}
	}
}

func arrangeQuestions(n int) []testfmt.Question {
	rich := func(s string) json.RawMessage {
		return json.RawMessage(fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q}]}]}`, s))
	}
	var order, left, items, words []testfmt.Option
	var right []testfmt.Target
	body := `{"type":"doc","content":[{"type":"paragraph","content":[`
	for i := range n {
		id := fmt.Sprint(i)
		order = append(order, testfmt.Option{ID: "o" + id, Content: rich("o" + id)})
		left = append(left, testfmt.Option{ID: "l" + id, Content: rich("l" + id), Target: "r" + id})
		right = append(right, testfmt.Target{ID: "r" + id, Content: rich("r" + id)})
		items = append(items, testfmt.Option{ID: "i" + id, Content: rich("i" + id), Target: "t" + fmt.Sprint(i%2)})
		words = append(words, testfmt.Option{ID: "w" + id, Content: rich("w" + id), Target: "g" + id})
		body += fmt.Sprintf(`{"type":"gap","attrs":{"id":"g%d"}},`, i)
	}
	body = body[:len(body)-1] + `]}]}`
	return []testfmt.Question{
		{ID: "q1", Type: "order", Text: rich("Q"), Points: 1, Options: order},
		{ID: "q2", Type: "match", Text: rich("Q"), Points: 1, Options: left, Targets: right},
		{ID: "q3", Type: "groups", Text: rich("Q"), Points: 1, Options: items,
			Targets: []testfmt.Target{{ID: "t0", Content: rich("A")}, {ID: "t1", Content: rich("B")}}},
		{ID: "q4", Type: "bank", Points: 1, Body: json.RawMessage(body), Options: words},
	}
}

func targetIDs(q wire.StudentQuestion) []string {
	var ids []string
	for _, g := range q.Targets {
		ids = append(ids, g.ID)
	}
	return ids
}

func TestStudentPayloadArrange(t *testing.T) {
	for n := 2; n <= 6; n++ {
		raw, err := json.Marshal(testfmt.Test{ID: "t", Version: 1, Title: "T", Questions: arrangeQuestions(n)})
		if err != nil {
			t.Fatal(err)
		}
		tst, err := testfmt.Decode(raw)
		if err != nil {
			t.Fatal(err)
		}
		key := func(i int) []string {
			var ids []string
			for _, o := range tst.Questions[i].Options {
				ids = append(ids, o.ID)
			}
			return ids
		}
		var sawTargetShuffle, sawItemShuffle, sawWordShuffle bool
		for d := range 50 {
			device := fmt.Sprintf("dev%d", d)
			st := studentTest(tst, tst.Questions, device)
			order, match, groups, bank := st.Questions[0], st.Questions[1], st.Questions[2], st.Questions[3]

			got := optionIDs(order)
			if slices.Equal(got, key(0)) || !slices.Equal(slices.Sorted(slices.Values(got)), key(0)) {
				t.Fatalf("n=%d %s: order options %v must be a shuffle of %v, not the key", n, device, got, key(0))
			}
			if !slices.Equal(optionIDs(studentTest(tst, tst.Questions, device).Questions[0]), got) {
				t.Fatalf("n=%d %s: the order shuffle must be fixed per device", n, device)
			}

			if !slices.Equal(optionIDs(match), key(1)) {
				t.Fatalf("n=%d: match options must keep their order: %v", n, optionIDs(match))
			}
			tg := targetIDs(match)
			if len(tg) != n {
				t.Fatalf("n=%d: match targets = %v", n, tg)
			}
			sawTargetShuffle = sawTargetShuffle || !slices.IsSorted(tg)

			if !slices.Equal(targetIDs(groups), []string{"t0", "t1"}) {
				t.Fatalf("groups targets must keep their order: %v", targetIDs(groups))
			}
			sawItemShuffle = sawItemShuffle || !slices.Equal(optionIDs(groups), key(2))

			if string(bank.Body) != string(tst.Questions[3].Body) || len(bank.Gaps) != 0 {
				t.Fatalf("bank sends its body and no gaps: %+v", bank)
			}
			sawWordShuffle = sawWordShuffle || !slices.Equal(optionIDs(bank), key(3))

			js, err := json.Marshal(st)
			if err != nil {
				t.Fatal(err)
			}
			for _, leak := range []string{`"target":`, `"correct":`, `"partial":`} {
				if strings.Contains(string(js), leak) {
					t.Fatalf("payload carries %s: %s", leak, js)
				}
			}
		}
		if !sawTargetShuffle || !sawItemShuffle || !sawWordShuffle {
			t.Errorf("n=%d: match targets, group items and bank words should shuffle: %v %v %v", n, sawTargetShuffle, sawItemShuffle, sawWordShuffle)
		}
	}
}

func TestNavigationReachesStudent(t *testing.T) {
	for _, nav := range []string{testfmt.NavFree, testfmt.NavForward} {
		e, _ := setupSettings(t, 2, testfmt.Settings{Navigation: nav})
		info := start(t, e, nil)
		if j := join(t, e, info.Code, devA, "10.0.0.1"); j.Navigation != nav {
			t.Errorf("join navigation = %q, want %q", j.Navigation, nav)
		}
		pick(t, e, info.Code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Учень"})
		st, err := testFor(e, devA)
		if err != nil {
			t.Fatal(err)
		}
		if st.Navigation != nav {
			t.Errorf("test navigation = %q, want %q", st.Navigation, nav)
		}
	}
}
