package mtftest

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"klats/internal/mtf"
)

var update = flag.Bool("update", false, "write the e2e fixtures instead of checking them")

// fixtures are the older-format files the e2e specs open, by file name under
// web/e2e/fixtures. older.mtf holds a question of every type but true or
// false, and converts with three notes: on its two themes asking one question
// each, on question 3's item outside the order and on question 7's L-shaped
// click area. older-clean.mtf converts with none, and older-many.mtf with a
// hint_dropped note on each of its 30 questions.
var fixtures = map[string][]byte{
	"older.mtf": Encode(mtf.File{
		Title:  "Старий тест",
		Themes: []mtf.Theme{{ID: 1, Ask: 1, AskOn: true}, {ID: 2, Ask: 1, AskOn: true}},
		Questions: []mtf.Question{
			{Type: 1, Points: 1, ThemeID: 1, Text: RTF("Скільки біт в одному байті?"),
				Answers: []string{RTF("4"), RTF("8", WMF(BMP(16, 16), false, 0x0F43)), RTF("16")}, Keys: []uint32{0, 1, 0}},
			{Type: 2, Points: 2, ThemeID: 1, Text: RTF("Які з цих пристроїв є пристроями введення?"),
				Answers: []string{RTF("Клавіатура"), RTF("Мишка"), RTF("Монітор")}, Keys: []uint32{1, 1, 0}},
			{Type: 3, Points: 1, ThemeID: 2, Text: RTF("Розташуйте одиниці від найменшої до найбільшої."),
				Answers: []string{RTF("Кілобайт"), RTF("Біт"), RTF("Кілограм"), RTF("Байт")}, Keys: []uint32{3, 1, 0, 2}},
			{Type: 4, Points: 1, ThemeID: 2, Text: RTF("Доберіть пари."),
				Answers: []string{RTF("Клавіатура"), RTF("Монітор")}, Keys: []uint32{1, 2}, Right: []string{RTF("введення"), RTF("виведення")}},
			{Type: 6, Points: 1, Text: RTF("Скільки байтів у кілобайті?"), Lo: 1024, Hi: 1024},
			{Type: 7, Points: 1, Text: RTF("Як називають вісім біт?"), Accepted: "байт\r\nbyte"},
			{Type: 8, Points: 1, Text: RTF("Клацніть на зображенні потрібну область."), Picture: "{0D7C3A52-1B9E-4F60-8A2D-6E5B4C3F2A10}.bmp",
				Regions: [][]mtf.Point{{{X: 100, Y: 20}, {X: 180, Y: 20}, {X: 180, Y: 60}, {X: 140, Y: 60}, {X: 140, Y: 90}, {X: 100, Y: 90}}}},
		},
	}, Entry{Key: "{0D7C3A52-1B9E-4F60-8A2D-6E5B4C3F2A10}.bmp", Data: BMP(200, 100)}),
	"older-clean.mtf": Encode(mtf.File{
		Title: "Байти",
		Questions: []mtf.Question{
			{Type: 1, Points: 1, Text: RTF("Скільки біт в одному байті?"),
				Answers: []string{RTF("4"), RTF("8"), RTF("16")}, Keys: []uint32{0, 1, 0}},
		},
	}),
	"older-many.mtf": Encode(mtf.File{Title: "Багато підказок", Questions: hinted(30)}),
}

// hinted returns n number questions, each with a hint.
func hinted(n int) []mtf.Question {
	qs := make([]mtf.Question, n)
	for i := range qs {
		qs[i] = mtf.Question{Type: 6, Points: 1, Text: RTF("Скільки буде " + strconv.Itoa(i) + " + 1?"),
			Lo: float64(i + 1), Hi: float64(i + 1), Hint: RTF("Додайте одиницю.")}
	}
	return qs
}

// TestE2EFixtures checks that the committed e2e fixtures are what Encode makes
// of fixtures; -update writes them.
func TestE2EFixtures(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "web", "e2e", "fixtures")
	for name, want := range fixtures {
		path := filepath.Join(dir, name)
		if *update {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, want, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s differs from what Encode makes; run go test ./internal/mtf/mtftest -run TestE2EFixtures -update", path)
		}
	}
}
