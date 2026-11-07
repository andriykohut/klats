// Package xlsx writes an assignment's results as an Excel workbook for the
// teacher to keep. Numbers, dates and student names are typed cells: names are
// always plain strings, so a name beginning with "=" is never a formula.
package xlsx

import (
	"cmp"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"klats/internal/httpx"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

const (
	maxQuestionRunes = 200
	maxTitleRunes    = 100
)

type labels struct {
	results, questions                         string
	no, student, class, points, grade, timeCol string
	date, question, correct                    string
	pass, fail                                 string
	tags, wholeClass                           string
}

var (
	uk = labels{"Результати", "Питання", "№", "Учень", "Клас", "Бали", "Оцінка", "Час", "Дата", "Питання", "Правильно", "зараховано", "не зараховано", "Теги", "Увесь клас"}
	en = labels{"Results", "Questions", "No.", "Student", "Class", "Points", "Grade", "Time", "Date", "Question", "Correct", "pass", "fail", "Tags", "Whole class"}
)

// Export writes the workbook for r to w. lang "en" gives English sheet and
// column names; any other value gives Ukrainian. Question columns on the
// results sheet are headed by question number, and the questions sheet maps
// the numbers to text cut at 200 characters. The grade column holds the grade
// as a number, or on the pass/fail scale the word for it. A row with a written
// answer waiting for the teacher has an empty grade cell, and that answer an
// empty points cell; a question the student did not get also has an empty
// points cell. On the questions sheet the percent is blank for a question with
// no [wire.ResultQuestion.CorrectPct]. When r has tags, a third sheet has one
// column per tag with each student's percent ([wire.ResultRow.TagPct]) and a
// last row with the whole class's ([wire.AssignmentResults.Tags]); a nil
// percent is blank.
func Export(w io.Writer, r wire.AssignmentResults, lang string) error {
	l := uk
	if lang == "en" {
		l = en
	}
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return err
	}
	decimal, err := f.NewStyle(&excelize.Style{CustomNumFmt: new("0.0")})
	if err != nil {
		return err
	}
	date, err := f.NewStyle(&excelize.Style{CustomNumFmt: new("dd.mm.yyyy")})
	if err != nil {
		return err
	}

	if err := f.SetSheetName("Sheet1", l.results); err != nil {
		return err
	}
	if _, err := f.NewSheet(l.questions); err != nil {
		return err
	}

	qn := len(r.Questions)
	header := []string{l.no, l.student, l.class}
	for i := range qn {
		header = append(header, fmt.Sprint(i+1))
	}
	header = append(header, l.points, l.grade, l.timeCol, l.date)
	res := &sheet{f: f, name: l.results}
	res.header(header, bold)
	for i, row := range r.Rows {
		n := i + 2
		res.put(1, n, i+1, 0)
		res.put(2, n, row.Name, 0)
		res.put(3, n, row.ClassName, 0)
		for q := range min(qn, len(row.Points)) {
			question := r.Questions[q].Question
			if !slices.Contains(row.PendingIDs, question.ID) && !slices.Contains(row.NotAsked, question.ID) {
				res.put(4+q, n, row.Points[q], decimal)
			}
		}
		res.put(4+qn, n, row.Earned, decimal)
		if len(row.PendingIDs) == 0 {
			switch {
			case r.Scale != testfmt.ScalePass:
				res.put(5+qn, n, row.Grade, 0)
			case row.Grade == 1:
				res.put(5+qn, n, l.pass, 0)
			default:
				res.put(5+qn, n, l.fail, 0)
			}
		}
		if row.DurationSec > 0 {
			res.put(6+qn, n, fmt.Sprintf("%02d:%02d", row.DurationSec/60, row.DurationSec%60), 0)
		}
		// The workbook stores no time zone, so the local calendar day is
		// written as the same day in UTC.
		d := time.UnixMilli(row.SittingDate).In(time.Local)
		res.put(7+qn, n, time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC), date)
	}
	res.width(1, 1, 6)
	res.width(2, 2, 32)
	res.width(3, 3, 12)
	res.width(4, 3+qn, 6)
	res.width(4+qn, 6+qn, 8)
	// Wide enough for dd.mm.yyyy; a narrower date column shows hashes in Excel.
	res.width(7+qn, 7+qn, 12)
	if res.err != nil {
		return res.err
	}

	qs := &sheet{f: f, name: l.questions}
	qs.header([]string{l.no, l.question, l.correct, "%"}, bold)
	for i, q := range r.Questions {
		qs.put(1, i+2, i+1, 0)
		qs.put(2, i+2, questionText(q), 0)
		qs.put(3, i+2, q.Correct, 0)
		if q.CorrectPct != nil {
			qs.put(4, i+2, *q.CorrectPct, 0)
		}
	}
	qs.width(1, 1, 6)
	qs.width(2, 2, 80)
	qs.width(3, 3, 12)
	if qs.err != nil {
		return qs.err
	}

	if len(r.Tags) > 0 {
		if _, err := f.NewSheet(l.tags); err != nil {
			return err
		}
		ts := &sheet{f: f, name: l.tags}
		header := []string{l.no, l.student}
		for _, t := range r.Tags {
			header = append(header, t.Tag)
		}
		ts.header(header, bold)
		for i, row := range r.Rows {
			ts.put(1, i+2, i+1, 0)
			ts.put(2, i+2, row.Name, 0)
			for j, p := range row.TagPct {
				if p != nil {
					ts.put(3+j, i+2, *p, 0)
				}
			}
		}
		last := len(r.Rows) + 2
		ts.put(2, last, l.wholeClass, bold)
		for j, t := range r.Tags {
			if t.Pct != nil {
				ts.put(3+j, last, *t.Pct, bold)
			}
		}
		ts.width(1, 1, 6)
		ts.width(2, 2, 32)
		ts.width(3, 2+len(r.Tags), 12)
		if ts.err != nil {
			return ts.err
		}
	}

	f.SetActiveSheet(0)
	return f.Write(w)
}

// sheet writes cells of one worksheet and keeps the first error, so callers
// check once after a batch of writes.
type sheet struct {
	f    *excelize.File
	name string
	err  error
}

func (s *sheet) do(err error) {
	if s.err == nil {
		s.err = err
	}
}

// put writes v at (col, row), both 1-based. Strings are always text cells.
// A zero style leaves the cell's style alone.
func (s *sheet) put(col, row int, v any, style int) {
	c, err := excelize.CoordinatesToCellName(col, row)
	s.do(err)
	s.do(s.f.SetCellValue(s.name, c, v))
	if style != 0 {
		s.do(s.f.SetCellStyle(s.name, c, c, style))
	}
}

// width sets the width of columns from..to (1-based, inclusive). An empty
// range is skipped.
func (s *sheet) width(from, to int, w float64) {
	if from > to {
		return
	}
	a, err := excelize.ColumnNumberToName(from)
	s.do(err)
	b, err := excelize.ColumnNumberToName(to)
	s.do(err)
	s.do(s.f.SetColWidth(s.name, a, b, w))
}

// header writes a bold header row and freezes it.
func (s *sheet) header(cells []string, bold int) {
	for i, h := range cells {
		s.put(i+1, 1, h, bold)
	}
	s.do(s.f.SetPanes(s.name, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}))
}

// questionText is the plain text of the question, empty when it does not
// parse.
func questionText(q wire.ResultQuestion) string {
	s := []rune(q.Question.PlainText())
	if len(s) > maxQuestionRunes {
		return string(s[:maxQuestionRunes]) + "…"
	}
	return string(s)
}

// FileName is the download name for the export:
// "<title> — <class> — YYYY-MM-DD.xlsx", with the date of the earliest
// sitting. The class and date parts are left out when the class is empty or
// there are no rows. Characters invalid in Windows file names become "_".
func FileName(r wire.AssignmentResults) string {
	title := httpx.SafeFileName(r.TestTitle, maxTitleRunes)
	if title == "" {
		title = "Тест"
	}
	parts := []string{title}
	if c := httpx.SafeFileName(r.ClassName, 0); c != "" {
		parts = append(parts, c)
	}
	if len(r.Rows) > 0 {
		first := slices.MinFunc(r.Rows, func(a, b wire.ResultRow) int { return cmp.Compare(a.SittingDate, b.SittingDate) })
		parts = append(parts, time.UnixMilli(first.SittingDate).In(time.Local).Format("2006-01-02"))
	}
	return strings.Join(parts, " — ") + ".xlsx"
}
