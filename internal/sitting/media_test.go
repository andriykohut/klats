package sitting

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

func mediaTest(t *testing.T, st *store.Store, imgA, imgB string) {
	t.Helper()
	text := json.RawMessage(`{"type":"doc","content":[{"type":"image","attrs":{"src":"` + imgA + `","w":8,"h":6}}]}`)
	opts := []testfmt.Option{
		{ID: "o0", Content: rich("так"), Correct: true, Image: &testfmt.Image{Src: imgB, W: 40, H: 30}},
		{ID: "o1", Content: rich("ні")},
	}
	doc, err := json.Marshal(testfmt.Test{ID: "tm", Version: 1, Title: "Фото", Palette: "teal", Questions: []testfmt.Question{
		{ID: "q1", Type: "single", Text: text, Points: 1, Options: opts},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "tm", Title: "Фото", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
}

func TestStudentPayloadOptionImage(t *testing.T) {
	e, st, _ := setup(t)
	imgA, imgB := strings.Repeat("a", 64)+".png", strings.Repeat("b", 64)+".jpg"
	mediaTest(t, st, imgA, imgB)
	info, err := e.Start("tm", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	join(t, e, info.Code, devA, "10.0.0.107")
	pick(t, e, info.Code, devA, wire.PickRequest{Surname: "Шевченко", FirstName: "Тарас"})
	res, err := testFor(e, devA)
	if err != nil {
		t.Fatal(err)
	}
	opt := res.Questions[0].Options[0]
	if opt.Image == nil || *opt.Image != (testfmt.Image{Src: imgB, W: 40, H: 30}) {
		t.Errorf("option image = %+v", opt.Image)
	}
	if res.Questions[0].Options[1].Image != nil {
		t.Error("an option without an image got one")
	}
	b, _ := json.Marshal(res)
	if strings.Contains(string(b), `"correct"`) {
		t.Errorf("payload has a correct key: %s", b)
	}
}

func TestHasMedia(t *testing.T) {
	e, st, hub := setup(t)
	imgA, imgB, other := strings.Repeat("a", 64)+".png", strings.Repeat("b", 64)+".jpg", strings.Repeat("c", 64)+".png"
	mediaTest(t, st, imgA, imgB)
	if e.HasMedia(imgA) {
		t.Fatal("HasMedia before any sitting")
	}
	if _, err := e.Start("tm", nil, 0); err != nil {
		t.Fatal(err)
	}
	check := func(when string, e *Engine) {
		t.Helper()
		if !e.HasMedia(imgA) || !e.HasMedia(imgB) || e.HasMedia(other) || e.HasMedia("") {
			t.Errorf("%s: HasMedia wrong for the test's names", when)
		}
	}
	check("running", e)
	if err := e.End(); err != nil {
		t.Fatal(err)
	}
	check("ended", e)
	check("ended, after a restart", newEngine(t, st, hub))
}
