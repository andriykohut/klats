package xlsx

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"klats/internal/testfmt"
	"klats/internal/wire"
)

func para(s string) []byte {
	return []byte(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + s + `"}]}]}`)
}

func sample() wire.AssignmentResults {
	noon := time.Date(2026, 10, 21, 12, 0, 0, 0, time.Local).UnixMilli()
	return wire.AssignmentResults{
		TestTitle: "Дроби", ClassName: "7-А",
		Questions: []wire.ResultQuestion{
			{Question: testfmt.Question{ID: "q1", Text: para("Скільки?")}, Correct: 1, CorrectPct: 50},
			{Question: testfmt.Question{ID: "q2", Text: para(strings.Repeat("я", 250))}, Correct: 2, CorrectPct: 100},
			{Question: testfmt.Question{ID: "q3", Text: []byte(`{"type":"nope"}`)}},
		},
		Rows: []wire.ResultRow{
			{Name: "=1+1", ClassName: "7-А", Points: []float64{2, 1.5, 0}, Earned: 3.5, Max: 5, Grade: 8, DurationSec: 75*60 + 3, SittingDate: noon},
			{Name: "Шевченко Тарас", ClassName: "7-Б", Points: []float64{0, 3, 0}, Earned: 3, Max: 5, Grade: 7, SittingDate: noon},
		},
	}
}

func open(t *testing.T, r wire.AssignmentResults, lang string) *excelize.File {
	t.Helper()
	var buf bytes.Buffer
	if err := Export(&buf, r, lang); err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(&buf)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = f.Close() })
	return f
}

func row(t *testing.T, f *excelize.File, sheet string, n int, raw bool) []string {
	t.Helper()
	var out []string
	for c := 1; ; c++ {
		name, _ := excelize.CoordinatesToCellName(c, n)
		v, err := f.GetCellValue(sheet, name, excelize.Options{RawCellValue: raw})
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, v)
		if c >= 20 {
			break
		}
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out
}

func eq(t *testing.T, what string, got, want []string) {
	t.Helper()
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("%s = %q, want %q", what, got, want)
	}
}

func TestExportCells(t *testing.T) {
	f := open(t, sample(), "uk")
	if got := f.GetSheetList(); strings.Join(got, "|") != "Результати|Питання" {
		t.Fatalf("sheets = %q", got)
	}
	eq(t, "header", row(t, f, "Результати", 1, false), []string{"№", "Учень", "Клас", "1", "2", "3", "Бали", "Оцінка", "Час", "Дата"})
	eq(t, "row 2", row(t, f, "Результати", 2, false), []string{"1", "=1+1", "7-А", "2.0", "1.5", "0.0", "3.5", "8", "75:03", "21.10.2026"})
	eq(t, "row 3", row(t, f, "Результати", 3, false), []string{"2", "Шевченко Тарас", "7-Б", "0.0", "3.0", "0.0", "3.0", "7", "", "21.10.2026"})

	// Numeric cells carry no t attribute, which excelize reports as unset.
	for cell, want := range map[string]excelize.CellType{"A2": excelize.CellTypeUnset, "B2": excelize.CellTypeSharedString, "D2": excelize.CellTypeUnset, "G2": excelize.CellTypeUnset, "H2": excelize.CellTypeUnset, "J2": excelize.CellTypeUnset} {
		if got, _ := f.GetCellType("Результати", cell); got != want {
			t.Errorf("type of %s = %v, want %v", cell, got, want)
		}
	}
	if fm, _ := f.GetCellFormula("Результати", "B2"); fm != "" {
		t.Errorf("name cell holds formula %q", fm)
	}
	if v, _ := f.GetCellValue("Результати", "J2", excelize.Options{RawCellValue: true}); v != "46316" {
		t.Errorf("date serial = %q, want 46316", v)
	}

	eq(t, "questions header", row(t, f, "Питання", 1, false), []string{"№", "Питання", "Правильно", "%"})
	eq(t, "question 1", row(t, f, "Питання", 2, false), []string{"1", "Скільки?", "1", "50"})
	eq(t, "question 2", row(t, f, "Питання", 3, false), []string{"2", strings.Repeat("я", 200) + "…", "2", "100"})
	eq(t, "question 3", row(t, f, "Питання", 4, false), []string{"3", "", "0", "0"})
	if got, _ := f.GetCellType("Питання", "D3"); got != excelize.CellTypeUnset {
		t.Errorf("type of D3 = %v", got)
	}

	for _, sheet := range []string{"Результати", "Питання"} {
		p, err := f.GetPanes(sheet)
		if err != nil || !p.Freeze || p.YSplit != 1 {
			t.Errorf("%s panes = %+v, %v", sheet, p, err)
		}
		id, _ := f.GetCellStyle(sheet, "A1")
		st, _ := f.GetStyle(id)
		if st.Font == nil || !st.Font.Bold {
			t.Errorf("%s header not bold", sheet)
		}
	}
}

func TestExportEnglish(t *testing.T) {
	f := open(t, sample(), "en")
	if got := f.GetSheetList(); strings.Join(got, "|") != "Results|Questions" {
		t.Fatalf("sheets = %q", got)
	}
	eq(t, "header", row(t, f, "Results", 1, false), []string{"No.", "Student", "Class", "1", "2", "3", "Points", "Grade", "Time", "Date"})
	eq(t, "questions header", row(t, f, "Questions", 1, false), []string{"No.", "Question", "Correct", "%"})
	if got := open(t, sample(), "de").GetSheetList(); got[0] != "Результати" {
		t.Errorf("unknown lang sheets = %q", got)
	}
}

func TestFileName(t *testing.T) {
	r := sample()
	for _, tc := range []struct {
		name string
		edit func(*wire.AssignmentResults)
		want string
	}{
		{"plain", func(*wire.AssignmentResults) {}, "Дроби — 7-А — 2026-10-21.xlsx"},
		{"slash", func(r *wire.AssignmentResults) { r.TestTitle = `Дроби 1/2: "що?"` }, "Дроби 1_2_ _що__ — 7-А — 2026-10-21.xlsx"},
		{"empty class", func(r *wire.AssignmentResults) { r.ClassName = "" }, "Дроби — 2026-10-21.xlsx"},
		{"earliest not first", func(r *wire.AssignmentResults) {
			day := func(d int) int64 { return time.Date(2026, 10, d, 12, 0, 0, 0, time.Local).UnixMilli() }
			r.Rows = []wire.ResultRow{{SittingDate: day(22)}, {SittingDate: day(21)}, {SittingDate: day(23)}}
		}, "Дроби — 7-А — 2026-10-21.xlsx"},
		{"no rows", func(r *wire.AssignmentResults) { r.Rows = nil }, "Дроби — 7-А.xlsx"},
		{"long title", func(r *wire.AssignmentResults) { r.TestTitle = strings.Repeat("ї", 150) }, strings.Repeat("ї", 100) + " — 7-А — 2026-10-21.xlsx"},
		{"empty title", func(r *wire.AssignmentResults) { r.TestTitle = " . " }, "Тест — 7-А — 2026-10-21.xlsx"},
		{"trailing dot and control", func(r *wire.AssignmentResults) { r.TestTitle = "Тест\n1..." }, "Тест_1 — 7-А — 2026-10-21.xlsx"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := r
			tc.edit(&c)
			if got := FileName(c); got != tc.want {
				t.Errorf("FileName = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDateColumnWidth(t *testing.T) {
	f := open(t, sample(), "uk")
	// Columns: 3 fixed, 3 questions, then Бали, Оцінка, Час, Дата.
	w, err := f.GetColWidth("Результати", "J")
	if err != nil || w < 11 {
		t.Errorf("date column width = %v, %v; want at least 11", w, err)
	}
}

func TestQuestionCut(t *testing.T) {
	for _, tc := range []struct {
		runes int
		want  string
	}{
		{200, strings.Repeat("я", 200)},
		{201, strings.Repeat("я", 200) + "…"},
	} {
		r := wire.AssignmentResults{Questions: []wire.ResultQuestion{{Question: testfmt.Question{Text: para(strings.Repeat("я", tc.runes))}}}}
		f := open(t, r, "uk")
		if got, _ := f.GetCellValue("Питання", "B2"); got != tc.want {
			t.Errorf("%d runes: got %d runes, want %d", tc.runes, len([]rune(got)), len([]rune(tc.want)))
		}
	}
}

// Not parallel: it replaces the process-wide time.Local.
func TestLocalDate(t *testing.T) {
	old := time.Local
	time.Local = time.FixedZone("x", 13*3600)
	t.Cleanup(func() { time.Local = old })
	r := sample()
	// 23:00 UTC is 12:00 the next day at UTC+13.
	late := time.Date(2026, 10, 21, 23, 0, 0, 0, time.UTC).UnixMilli()
	r.Rows[0].SittingDate, r.Rows[1].SittingDate = late, late
	f := open(t, r, "uk")
	if got, _ := f.GetCellValue("Результати", "J2"); got != "22.10.2026" {
		t.Errorf("date cell = %q, want 22.10.2026", got)
	}
	if got := FileName(r); got != "Дроби — 7-А — 2026-10-22.xlsx" {
		t.Errorf("FileName = %q", got)
	}
}

type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("disk full") }

func TestExportWriteError(t *testing.T) {
	if err := Export(failWriter{}, sample(), "uk"); err == nil {
		t.Error("Export to a failing writer returned nil")
	}
}
