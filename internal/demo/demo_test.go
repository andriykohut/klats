package demo

import (
	"context"
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"klats/internal/events"
	"klats/internal/media"
	"klats/internal/rich"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/testfmt"
	"klats/internal/wire"
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
	ms, err := media.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	info, err := Seed(st, eng, ms)
	if err != nil {
		t.Fatal(err)
	}
	if !eng.Active() || eng.SittingID() != info.SittingID {
		t.Fatalf("sitting %q is not the running one", info.SittingID)
	}
	if info.ClassName != "7-Б" || info.QuestionCount != 8 {
		t.Errorf("sitting of class %q with %d questions, want 7-Б with 8", info.ClassName, info.QuestionCount)
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
	for _, node := range []string{"math", "table", "tableHeader", "codeBlock"} {
		if !strings.Contains(tests[0].Doc, `"type":"`+node+`"`) {
			t.Errorf("no %s in the sample test", node)
		}
	}
	for _, node := range []string{"image", "audio"} {
		if !strings.Contains(tests[0].Doc, `"type":"`+node+`"`) {
			t.Errorf("no %s in the sample test", node)
		}
	}
	// Images and audio are block nodes, so they sit at the top level of the text.
	var q8 rich.Doc
	if err := json.Unmarshal(test.Questions[7].Text, &q8); err != nil {
		t.Fatal(err)
	}
	var top []string
	for _, n := range q8.Content {
		top = append(top, n.Type)
	}
	if !slices.Equal(top, []string{"paragraph", "image", "audio"}) {
		t.Errorf("question 8 text holds %v, want a paragraph, an image and an audio", top)
	}
	files := test.Media()
	if len(files) != 2 {
		t.Errorf("sample test uses media %v, want its image and audio", files)
	}
	for _, name := range files {
		f, _, err := ms.Open(name)
		if err != nil {
			t.Errorf("media %s is not stored: %v", name, err)
			continue
		}
		_ = f.Close()
	}
	withImage := 0
	for _, q := range test.Questions {
		for _, o := range q.Options {
			if o.Image != nil {
				withImage++
			}
		}
	}
	if withImage != 1 {
		t.Errorf("%d options with an image, want 1", withImage)
	}
}

// A second run in the same data folder finds the sitting still running and
// returns it. After that sitting ends, a third run starts a new one. Neither
// stores the class or the test again.
func TestSeedAgainReusesTheLesson(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	ms, err := media.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Each run is a new program over the same database, so a new engine.
	run := func() (*sitting.Engine, wire.SittingInfo) {
		t.Helper()
		eng, err := sitting.New(st, events.New(), time.Now)
		if err != nil {
			t.Fatal(err)
		}
		info, err := Seed(st, eng, ms)
		if err != nil {
			t.Fatal(err)
		}
		return eng, info
	}
	stored := func() {
		t.Helper()
		classes, err := st.Q().ListClassSummaries(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		tests, err := st.Q().ListTests(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if len(classes) != 1 || classes[0].StudentCount != 25 || len(tests) != 1 {
			t.Errorf("%d classes (%+v) and %d tests stored, want one of each", len(classes), classes, len(tests))
		}
	}

	_, first := run()
	eng, again := run()
	if again.SittingID != first.SittingID || again.Code != first.Code || again.Ended {
		t.Errorf("second run = %+v, want the running sitting %+v", again, first)
	}
	stored()

	if err := eng.End(); err != nil {
		t.Fatal(err)
	}
	eng, next := run()
	if next.SittingID == first.SittingID || !eng.Active() || next.ClassName != "7-Б" {
		t.Errorf("run after the end = %+v, want a new running sitting of 7-Б", next)
	}
	stored()
}
