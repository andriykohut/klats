package demo

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"klats/internal/events"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/testfmt"
)

func TestSeedStartsASittingOfTheClassAndTest(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	eng, err := sitting.New(st, events.New(), time.Now)
	if err != nil {
		t.Fatal(err)
	}

	info, err := Seed(st, eng)
	if err != nil {
		t.Fatal(err)
	}
	if !eng.Active() || eng.SittingID() != info.SittingID {
		t.Fatalf("sitting %q is not the running one", info.SittingID)
	}
	if info.ClassName != "7-Б" || info.QuestionCount != 6 {
		t.Errorf("sitting of class %q with %d questions, want 7-Б with 6", info.ClassName, info.QuestionCount)
	}

	join, err := eng.Join(info.Code, strings.Repeat("a", 26), "10.0.0.5")
	if err != nil {
		t.Fatal(err)
	}
	if join.Mode != "list" || len(join.Names) != 25 {
		t.Errorf("join shows %d names in mode %q, want the class list of 25", len(join.Names), join.Mode)
	}

	tests, err := st.Q().ListTests(context.Background())
	if err != nil || len(tests) != 1 {
		t.Fatalf("%d stored tests (%v), want 1", len(tests), err)
	}
	test, err := testfmt.Decode([]byte(tests[0].Doc))
	if err != nil {
		t.Fatal(err)
	}
	if p := test.Problems(); len(p) > 0 {
		t.Errorf("the sample test has problems: %+v", p)
	}
	types := map[string]bool{}
	for _, q := range test.Questions {
		types[q.Type] = true
	}
	if !types["single"] || !types["multi"] {
		t.Errorf("question types %v, want single and multi", types)
	}
	for _, mark := range []string{"bold", "subscript", "superscript"} {
		if !strings.Contains(tests[0].Doc, `{"type":"`+mark+`"}`) {
			t.Errorf("no %s text in the sample test", mark)
		}
	}
}
