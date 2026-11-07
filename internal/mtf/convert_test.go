package mtf_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/andriykohut/klats/internal/mtf"
	"github.com/andriykohut/klats/internal/mtf/mtftest"
	"github.com/andriykohut/klats/internal/rich"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// open returns f, with the media table given, opened into a new store.
func open(t *testing.T, f mtf.File, media ...mtftest.Entry) (testfmt.Test, []wire.OpenNote) {
	t.Helper()
	ms, _ := store(t)
	got, notes, err := mtf.Open(bytes.NewReader(mtftest.Encode(f, media...)), ms)
	if err != nil {
		t.Fatal(err)
	}
	return got, notes
}

// openOne returns the question of a file holding q alone, and the notes.
func openOne(t *testing.T, q mtf.Question, media ...mtftest.Entry) (testfmt.Question, []wire.OpenNote) {
	t.Helper()
	got, notes := open(t, mtf.File{Questions: []mtf.Question{q}}, media...)
	return got.Questions[0], notes
}

func wantNotes(t *testing.T, got []wire.OpenNote, want ...wire.OpenNote) {
	t.Helper()
	if len(got) != 0 || len(want) != 0 {
		if !reflect.DeepEqual(got, want) {
			t.Errorf("notes = %+v, want %+v", got, want)
		}
	}
}

func text(s string) rich.Node          { return rich.Node{Type: "text", Text: s} }
func para(runs ...rich.Node) rich.Node { return rich.Node{Type: "paragraph", Content: runs} }

func picture(im testfmt.Image) rich.Node {
	return rich.Node{Type: "image", Attrs: &rich.Attrs{Src: im.Src, W: im.W, H: im.H}}
}

// docOf returns the canonical JSON of a document of blocks.
func docOf(blocks ...rich.Node) string {
	b, _ := json.Marshal(rich.Doc{Type: "doc", Content: blocks})
	return string(b)
}

// contents returns the plain text of each option.
func contents(t *testing.T, opts []testfmt.Option) []string {
	t.Helper()
	var out []string
	for _, o := range opts {
		doc, err := rich.Parse(o.Content, rich.Inline)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, doc.PlainText())
	}
	return out
}

func corrects(opts []testfmt.Option) []bool {
	var out []bool
	for _, o := range opts {
		out = append(out, o.Correct)
	}
	return out
}

func TestOpenTypes(t *testing.T) {
	t.Run("title", func(t *testing.T) {
		if got, _ := open(t, mtf.File{Title: "  Дроби \t"}); got.Title != "Дроби" {
			t.Errorf("title = %q, want %q", got.Title, "Дроби")
		}
	})
	t.Run("single", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 1, Points: 2, Answers: []string{"A", "B", "C"}, Keys: []uint32{0, 1, 0}})
		if q.ID != "q1" || q.Type != "single" || q.Points != 2 || !q.ShuffleOptions {
			t.Errorf("question = %+v, want q1, single, 2 points, shuffled", q)
		}
		if got := contents(t, q.Options); !reflect.DeepEqual(got, []string{"A", "B", "C"}) {
			t.Errorf("options = %q", got)
		}
		if got := corrects(q.Options); !reflect.DeepEqual(got, []bool{false, true, false}) {
			t.Errorf("correct = %v", got)
		}
		if q.Options[0].ID != "q1o1" || q.Options[2].ID != "q1o3" {
			t.Errorf("option ids %q, %q, want q1o1, q1o3", q.Options[0].ID, q.Options[2].ID)
		}
		wantNotes(t, notes)
	})
	t.Run("multi", func(t *testing.T) {
		q, _ := openOne(t, mtf.Question{Type: 2, Points: 1, Answers: []string{"A", "B", "C"}, Keys: []uint32{1, 0, 1}})
		if q.Type != "multi" || !q.Partial || !q.ShuffleOptions {
			t.Errorf("question = %+v, want multi, partial, shuffled", q)
		}
		if got := corrects(q.Options); !reflect.DeepEqual(got, []bool{true, false, true}) {
			t.Errorf("correct = %v", got)
		}
	})
	t.Run("truefalse", func(t *testing.T) {
		q, _ := openOne(t, mtf.Question{Type: 5, Points: 1, Answers: []string{"yes", "no"}, Keys: []uint32{1, 2}})
		if q.Type != "truefalse" || !q.Partial {
			t.Errorf("question = %+v, want truefalse, partial", q)
		}
		if got := corrects(q.Options); !reflect.DeepEqual(got, []bool{true, false}) {
			t.Errorf("correct = %v", got)
		}
	})
	t.Run("order", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 3, Points: 3, Answers: []string{"A", "B", "C", "D"}, Keys: []uint32{3, 1, 2, 0}})
		if q.Type != "order" || !q.Partial {
			t.Errorf("question = %+v, want order, partial", q)
		}
		if got := contents(t, q.Options); !reflect.DeepEqual(got, []string{"B", "C", "A"}) {
			t.Errorf("options = %q, want B, C, A", got)
		}
		wantNotes(t, notes, wire.OpenNote{QuestionID: "q1", Code: "order_extra_dropped", Count: 1})
	})
	t.Run("match", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 4, Points: 4, Answers: []string{"L1", "L2", "L3", "L4"}, Keys: []uint32{2, 1, 9, 2}, Right: []string{"R1", "R2", "R3"}})
		if q.Type != "match" || !q.Partial {
			t.Errorf("question = %+v, want match, partial", q)
		}
		if got := contents(t, q.Options); !reflect.DeepEqual(got, []string{"L1", "L2", "L3", "L4"}) {
			t.Errorf("left = %q", got)
		}
		var right []string
		for _, g := range q.Targets {
			doc, _ := rich.Parse(g.Content, rich.Inline)
			right = append(right, g.ID+" "+doc.PlainText())
		}
		if want := []string{"q1t1 R1", "q1t2 R2", "q1t3 R3"}; !reflect.DeepEqual(right, want) {
			t.Errorf("right = %q, want %q", right, want)
		}
		var targets []string
		for _, o := range q.Options {
			targets = append(targets, o.Target)
		}
		// L3's key is out of range, and L4's names L1's partner again.
		if want := []string{"q1t2", "q1t1", "", ""}; !reflect.DeepEqual(targets, want) {
			t.Errorf("targets = %q, want %q", targets, want)
		}
		wantNotes(t, notes)
	})
	t.Run("number", func(t *testing.T) {
		got, _ := open(t, mtf.File{Questions: []mtf.Question{{Type: 6, Points: 1, Lo: 4, Hi: 4}, {Type: 6, Points: 1, Lo: 2, Hi: 4.5}}})
		if q := got.Questions[0]; q.Type != "number" || *q.Number != (testfmt.NumberKey{Mode: "exact", Value: 4}) {
			t.Errorf("lo == hi gives %+v, %+v", q, q.Number)
		}
		if k := got.Questions[1].Number; *k != (testfmt.NumberKey{Mode: "range", Min: 2, Max: 4.5}) {
			t.Errorf("lo < hi gives %+v", k)
		}
	})
	t.Run("short", func(t *testing.T) {
		long := strings.Repeat("ж", 250)
		q, notes := openOne(t, mtf.Question{Type: 7, Points: 1, Accepted: "буфер\r\n  buffer \r\n\r\n" + long})
		if want := []string{"буфер", "buffer", long[:2*200]}; q.Type != "short" || !reflect.DeepEqual(q.Accepted, want) || q.Match != nil {
			t.Errorf("question = %s %q %v, want short, %q, no match", q.Type, q.Accepted, q.Match, want)
		}
		wantNotes(t, notes, wire.OpenNote{QuestionID: "q1", Code: "text_cut"})
	})
	t.Run("hotspot", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 8, Points: 1, Picture: "{A}.bmp", Regions: [][]mtf.Point{
			{{20, 10}, {60, 10}, {60, 30}, {20, 30}},
			{{100, 20}, {180, 20}, {180, 60}, {140, 60}, {140, 90}, {100, 90}},
			{{0, 0}, {0, 0}, {0, 0}, {0, 0}},
		}}, mtftest.Entry{Key: "{A}.bmp", Data: mtftest.BMP(200, 100)})
		if q.Type != "hotspot" || q.Image == nil || q.Image.W != 200 || q.Image.H != 100 {
			t.Fatalf("question = %+v, want a hotspot on a 200×100 picture", q)
		}
		want := []testfmt.Area{
			{ID: "q1a1", Shape: "rect", X: 0.1, Y: 0.1, W: 0.2, H: 0.2},
			{ID: "q1a2", Shape: "rect", X: 0.5, Y: 0.2, W: 0.4, H: 0.7},
		}
		if !reflect.DeepEqual(q.Areas, want) {
			t.Errorf("areas = %+v, want %+v", q.Areas, want)
		}
		if string(q.Text) != `{"type":"doc","content":[]}` {
			t.Errorf("text = %s, want empty: the picture is the question's image", q.Text)
		}
		wantNotes(t, notes, wire.OpenNote{QuestionID: "q1", Code: "area_reshaped"})
	})
	t.Run("question text", func(t *testing.T) {
		q, _ := openOne(t, mtf.Question{Type: 1, Points: 1, Text: mtftest.RTF("перший\nдругий")})
		if want := docOf(para(text("перший")), para(text("другий"))); string(q.Text) != want {
			t.Errorf("text = %s, want %s", q.Text, want)
		}
	})
	t.Run("answer", func(t *testing.T) {
		q, _ := openOne(t, mtf.Question{Type: 1, Points: 1, Answers: []string{mtftest.RTF("перший\nдругий")}, Keys: []uint32{1}})
		if want := docOf(para(text("перший"), rich.Node{Type: "hardBreak"}, text("другий"))); string(q.Options[0].Content) != want {
			t.Errorf("content = %s, want %s", q.Options[0].Content, want)
		}
	})
}

func TestOpenPictures(t *testing.T) {
	ms, _ := store(t)
	bmp := mtftest.BMP(4, 3)
	wmf := mtftest.WMF(mtftest.BMP(2, 2), false, 0x0F43)
	fromMedia, _, _ := mtf.StorePicture(ms, bmp)
	fromWMF, _, _ := mtf.PictPicture(ms, mtf.Pict{Kind: "wmetafile", Data: wmf})

	t.Run("media picture", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 1, Points: 1, Text: mtftest.RTF("Що це?"), Picture: "{A}.bmp"}, mtftest.Entry{Key: "{A}.bmp", Data: bmp})
		if want := docOf(para(text("Що це?")), picture(fromMedia)); string(q.Text) != want {
			t.Errorf("text = %s, want %s", q.Text, want)
		}
		wantNotes(t, notes)
	})
	t.Run("pict in text", func(t *testing.T) {
		q, _ := openOne(t, mtf.Question{Type: 1, Points: 1, Text: mtftest.RTF("Що це?", wmf)})
		if want := docOf(para(text("Що це?")), picture(fromWMF)); string(q.Text) != want {
			t.Errorf("text = %s, want %s", q.Text, want)
		}
	})
	t.Run("pict in answer", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 1, Points: 1, Answers: []string{mtftest.RTF("A", wmf)}, Keys: []uint32{1}})
		if o := q.Options[0]; o.Image == nil || *o.Image != fromWMF || string(o.Content) != docOf(para(text("A"))) {
			t.Errorf("option = %s, %+v, want A with %+v", o.Content, o.Image, fromWMF)
		}
		wantNotes(t, notes)
	})
	t.Run("two picts in answer", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 1, Points: 1, Answers: []string{mtftest.RTF("A", wmf, wmf)}, Keys: []uint32{1}})
		if o := q.Options[0]; o.Image == nil || *o.Image != fromWMF {
			t.Errorf("option image = %+v, want %+v", o.Image, fromWMF)
		}
		wantNotes(t, notes, wire.OpenNote{QuestionID: "q1", Code: "image_lost", Count: 1})
	})
	pict := fmt.Sprintf(`{\pict\wmetafile8\picw1\pich1 %x}`, wmf)
	t.Run("pict alone above a caption", func(t *testing.T) {
		q, notes := openOne(t, mtf.Question{Type: 1, Points: 1, Answers: []string{`{\rtf1\ansi ` + pict + `\par Caption}`}, Keys: []uint32{1}})
		if o := q.Options[0]; o.Image == nil || *o.Image != fromWMF || string(o.Content) != docOf(para(text("Caption"))) {
			t.Errorf("option = %s, %+v, want Caption with %+v", o.Content, o.Image, fromWMF)
		}
		wantNotes(t, notes)
	})
	t.Run("pict alone between lines", func(t *testing.T) {
		q, _ := openOne(t, mtf.Question{Type: 1, Points: 1, Answers: []string{`{\rtf1\ansi A\par ` + pict + `\par B}`}, Keys: []uint32{1}})
		if want := docOf(para(text("A"), rich.Node{Type: "hardBreak"}, text("B"))); string(q.Options[0].Content) != want {
			t.Errorf("content = %s, want %s", q.Options[0].Content, want)
		}
	})
	t.Run("hotspot picture refused", func(t *testing.T) {
		junk := make([]byte, 64)
		for i := range junk {
			junk[i] = byte(rand.N(256))
		}
		q, notes := openOne(t, mtf.Question{Type: 8, Points: 1, Picture: "{A}.bmp", Regions: [][]mtf.Point{{{1, 1}, {9, 1}, {9, 9}, {1, 9}}}},
			mtftest.Entry{Key: "{A}.bmp", Data: junk})
		if q.Image != nil {
			t.Errorf("image = %+v, want none", q.Image)
		}
		wantNotes(t, notes, wire.OpenNote{QuestionID: "q1", Code: "image_lost", Count: 1})
	})
}

func TestOpenSettings(t *testing.T) {
	t.Run("time limit", func(t *testing.T) {
		got, _ := open(t, mtf.File{TimeLimit: 361})
		if want := (testfmt.TimeLimit{Mode: "student", Minutes: 7}); got.Settings.TimeLimit != want {
			t.Errorf("time limit = %+v, want %+v", got.Settings.TimeLimit, want)
		}
		if !reflect.DeepEqual(got.Settings.Scale, testfmt.DefaultSettings().Scale) {
			t.Errorf("scale = %+v, want the default", got.Settings.Scale)
		}
	})
	t.Run("themes become tags and lines", func(t *testing.T) {
		got, notes := open(t, themed([]mtf.Theme{
			{ID: 0, Name: "Урок 1", Ask: 2, AskOn: true},
			{ID: 1, Name: " Урок 2 ", Ask: 1, AskOn: true},
			{ID: 2, Name: "Урок 3"},
			{ID: 3, Name: "Урок 4", AskOn: true},
			{ID: 4, Name: "Порожня", Ask: 1, AskOn: true},
		}, 3, 2, 2, 2))
		wantThemes(t, got, slices.Concat(tagged(3, "Урок 1"), tagged(2, "Урок 2"), tagged(2, "Урок 3"), tagged(2, "Урок 4")),
			[]testfmt.DrawLine{{Tag: "Урок 1", Count: 2}, {Tag: "Урок 2", Count: 1}, {Tag: "Урок 3", Count: 2}})
		wantNotes(t, notes)
	})
	t.Run("one theme gets no tags", func(t *testing.T) {
		got, notes := open(t, themed([]mtf.Theme{{ID: 0, Name: "Урок 1", Ask: 3, AskOn: true}}, 5))
		wantThemes(t, got, tagged(5), []testfmt.DrawLine{{Count: 3}})
		wantNotes(t, notes)
		got, _ = open(t, themed([]mtf.Theme{{ID: 0, Name: "Урок 1", Ask: 5, AskOn: true}}, 5))
		wantThemes(t, got, tagged(5), nil)
	})
	t.Run("repeated theme names stay apart", func(t *testing.T) {
		got, _ := open(t, themed([]mtf.Theme{{ID: 0, Name: "Урок 9", Ask: 1, AskOn: true}, {ID: 1, Name: "Урок 9", Ask: 1, AskOn: true}}, 2, 2))
		wantThemes(t, got, slices.Concat(tagged(2, "Урок 9"), tagged(2, "Урок 9 (2)")),
			[]testfmt.DrawLine{{Tag: "Урок 9", Count: 1}, {Tag: "Урок 9 (2)", Count: 1}})
	})
	t.Run("themes without picks", func(t *testing.T) {
		got, _ := open(t, themed([]mtf.Theme{{ID: 0, Name: "Урок 1"}, {ID: 1, Name: "Урок 2"}}, 1, 1))
		wantThemes(t, got, slices.Concat(tagged(1, "Урок 1"), tagged(1, "Урок 2")), nil)
	})
	t.Run("theme asking more than it holds", func(t *testing.T) {
		got, _ := open(t, themed([]mtf.Theme{{ID: 0, Name: "Урок 1", Ask: 5, AskOn: true}, {ID: 1, Name: "Урок 2", Ask: 1, AskOn: true}}, 2, 3))
		wantThemes(t, got, slices.Concat(tagged(2, "Урок 1"), tagged(3, "Урок 2")),
			[]testfmt.DrawLine{{Tag: "Урок 1", Count: 2}, {Tag: "Урок 2", Count: 1}})
	})
	t.Run("long and empty theme names", func(t *testing.T) {
		long := strings.Repeat("я", 300)
		got, _ := open(t, themed([]mtf.Theme{{ID: 0, Name: long}, {ID: 1, Name: long}, {ID: 7, Name: " "}}, 1, 1, 1))
		wantThemes(t, got, slices.Concat(tagged(1, long[:2*190]), tagged(1, long[:2*190]+" (2)"), tagged(1, "7")), nil)
	})
}

// themed returns a file of themes holding sizes[i] number questions in the
// i-th.
func themed(themes []mtf.Theme, sizes ...int) mtf.File {
	f := mtf.File{Themes: themes}
	for i, n := range sizes {
		for range n {
			f.Questions = append(f.Questions, mtf.Question{Type: 6, Points: 1, ThemeID: themes[i].ID})
		}
	}
	return f
}

// tagged returns the tags of n questions, each tagged with tags.
func tagged(n int, tags ...string) [][]string {
	out := make([][]string, n)
	for i := range out {
		out[i] = tags
	}
	return out
}

// wantThemes checks the tags of each question of got and its draw.
func wantThemes(t *testing.T, got testfmt.Test, tags [][]string, draw []testfmt.DrawLine) {
	t.Helper()
	var gotTags [][]string
	for _, q := range got.Questions {
		gotTags = append(gotTags, q.Tags)
	}
	if !reflect.DeepEqual(gotTags, tags) {
		t.Errorf("tags = %q, want %q", gotTags, tags)
	}
	if !reflect.DeepEqual(got.Settings.Draw, draw) {
		t.Errorf("draw = %+v, want %+v", got.Settings.Draw, draw)
	}
}

func TestOpenNotes(t *testing.T) {
	got, notes := open(t, mtf.File{Questions: []mtf.Question{
		{Type: 6, Points: 0, Hint: mtftest.RTF("підказка")},
		{Type: 6, Points: 15, Comment: mtftest.RTF("пояснення")},
		{Type: 6, Points: 1, Text: mtftest.RTF(strings.Repeat("я", 25000))},
	}})
	wantNotes(t, notes,
		wire.OpenNote{QuestionID: "q1", Code: "hint_dropped"},
		wire.OpenNote{QuestionID: "q2", Code: "hint_dropped"},
		wire.OpenNote{QuestionID: "q3", Code: "text_cut"})
	if p1, p2 := got.Questions[0].Points, got.Questions[1].Points; p1 != 1 || p2 != 12 {
		t.Errorf("points 0 and 15 give %d and %d, want 1 and 12", p1, p2)
	}
}

func TestOpenDecodes(t *testing.T) {
	f, _ := sample()
	got, _ := open(t, f, mtftest.Entry{Key: "{A1}.bmp", Data: mtftest.BMP(4, 3)}, mtftest.Entry{Key: "{B2}.jpg", Data: mtftest.BMP(300, 300)})
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	again, err := testfmt.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, again) {
		t.Errorf("Open = %+v\nDecode gives %+v", got, again)
	}
	if got.ID != "" || len(got.Questions) != len(f.Questions) {
		t.Errorf("Open gave id %q and %d questions, want none and %d", got.ID, len(got.Questions), len(f.Questions))
	}
}

func TestOpenNumberNotFinite(t *testing.T) {
	ms, _ := store(t)
	f := mtf.File{Questions: []mtf.Question{{Type: 6, Points: 1, Lo: math.NaN(), Hi: 1}}}
	if _, _, err := mtf.Open(bytes.NewReader(mtftest.Encode(f)), ms); !errors.Is(err, mtf.ErrDamaged) {
		t.Errorf("Open = %v, want ErrDamaged", err)
	}
}
