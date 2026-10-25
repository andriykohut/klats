// Package demo fills a data folder with a lesson in progress, so a newcomer
// can try both apps at once: `klats -dev -demo` seeds it and prints where to
// open them. It writes through the store and the sitting engine, as the
// teacher API would, and never runs in a normal launch.
package demo

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"klats/internal/media"
	"klats/internal/rich"
	"klats/internal/roster"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

// The class and the test have fixed ids, so a later run in the same data
// folder finds them instead of storing them again.
const (
	className = "7-Б"
	classID   = "demo-class"
	testID    = "demo-test"
)

var students = []string{
	"Бойко Назар", "Бондаренко Олена", "Гнатюк Ігор", "Гончаренко Ірина",
	"Зінченко Євген", "Коваль Максим", "Ковальчук Тарас", "Кравченко Богдан",
	"Кузьменко Злата", "Левченко Артем", "Лисенко Вікторія", "Литвиненко Христина",
	"Марченко Катерина", "Мельник Анастасія", "Мороз Олександр", "Олійник Дарина",
	"Павленко Юлія", "Петренко Іван", "Поліщук Ярина", "Романюк Владислав",
	"Руденко Марія", "Савченко Дмитро", "Ткаченко Софія", "Шевченко Андрій",
	"Ярошенко Остап",
}

// Text runs of a rich-text paragraph.
func plain(s string) rich.Node { return rich.Node{Type: "text", Text: s} }
func bold(s string) rich.Node  { return marked("bold", s) }
func sub(s string) rich.Node   { return marked("subscript", s) }
func sup(s string) rich.Node   { return marked("superscript", s) }

// formula is an inline formula of LaTeX source.
func formula(latex string) rich.Node {
	return rich.Node{Type: "math", Attrs: &rich.Attrs{Latex: latex}}
}

func marked(mark, s string) rich.Node {
	return rich.Node{Type: "text", Text: s, Marks: []rich.Mark{{Type: mark}}}
}

// para returns a one-paragraph document of the runs.
func para(runs ...rich.Node) json.RawMessage {
	b, err := json.Marshal(rich.Doc{Type: "doc", Content: []rich.Node{{Type: "paragraph", Content: runs}}})
	if err != nil {
		panic(err) // rich.Doc always marshals
	}
	return b
}

// doc returns a document of the blocks.
func doc(blocks ...rich.Node) json.RawMessage {
	b, err := json.Marshal(rich.Doc{Type: "doc", Content: blocks})
	if err != nil {
		panic(err) // rich.Doc always marshals
	}
	return b
}

// table returns a table of rows of cells; the first row is the header.
func table(rows ...[]string) rich.Node {
	t := rich.Node{Type: "table"}
	for i, row := range rows {
		tr := rich.Node{Type: "tableRow"}
		for _, cell := range row {
			kind := "tableCell"
			if i == 0 {
				kind = "tableHeader"
			}
			tr.Content = append(tr.Content, rich.Node{Type: kind, Content: []rich.Node{{Type: "paragraph", Content: []rich.Node{plain(cell)}}}})
		}
		t.Content = append(t.Content, tr)
	}
	return t
}

// codeBlock returns a block of source text in the code language lang.
func codeBlock(lang, src string) rich.Node {
	return rich.Node{Type: "codeBlock", Attrs: &rich.Attrs{Language: lang}, Content: []rich.Node{plain(src)}}
}

// choice returns a question worth points. The options at the indexes in
// correct are the right ones, and more than one makes it a multiple-choice
// question with partial credit.
func choice(id string, points int, text json.RawMessage, correct []int, options ...json.RawMessage) testfmt.Question {
	q := testfmt.Question{ID: id, Type: "single", Text: text, Points: points}
	if len(correct) > 1 {
		q.Type, q.Partial = "multi", true
	}
	for i, content := range options {
		q.Options = append(q.Options, testfmt.Option{ID: fmt.Sprintf("%so%d", id, i), Content: content, Correct: slices.Contains(correct, i)})
	}
	return q
}

// sampleTest is eight questions, single and multiple choice, with bold, sub-
// and superscript text, formulas in the text and options of the sixth, a table
// and a code block in the seventh, and the stored image pic and audio sound in
// the eighth.
func sampleTest(id, pic, sound string) testfmt.Test {
	return testfmt.Test{ID: id, Version: 1, Title: "Демонстраційний тест", Palette: testfmt.DefaultPalette, Questions: []testfmt.Question{
		choice("q1", 1, para(plain("Скільки "), bold("біт"), plain(" в одному байті?")), []int{1},
			para(plain("4")), para(plain("8")), para(plain("16")), para(plain("32"))),
		choice("q2", 2, para(plain("Які з цих пристроїв є пристроями "), bold("введення"), plain("?")), []int{0, 1},
			para(plain("Клавіатура")), para(plain("Мишка")), para(plain("Монітор")), para(plain("Принтер"))),
		choice("q3", 1, para(plain("Яка формула води?")), []int{0},
			para(plain("H"), sub("2"), plain("O")), para(plain("CO"), sub("2")), para(plain("O"), sub("2")), para(plain("H"), sub("2"), plain("O"), sub("2"))),
		choice("q4", 1, para(plain("Чому дорівнює 2"), sup("10"), plain("?")), []int{3},
			para(plain("20")), para(plain("100")), para(plain("512")), para(plain("1024"))),
		choice("q5", 2, para(plain("Які з цих чисел є "), bold("простими"), plain("?")), []int{0, 1, 3},
			para(plain("2")), para(plain("7")), para(plain("9")), para(plain("13")), para(plain("15"))),
		choice("q6", 1, para(plain("Скільки буде "), formula(`\frac{1}{2}+\frac{1}{4}`), plain("?")), []int{1},
			para(formula(`\frac{2}{6}`)), para(formula(`\frac{3}{4}`)), para(formula(`\sqrt{2}`))),
		choice("q7", 1, doc(
			rich.Node{Type: "paragraph", Content: []rich.Node{plain("Скористайтеся таблицею. Що виведе програма?")}},
			table([]string{"Рік", "Подія"}, []string{"1991", "Незалежність"}, []string{"1996", "Конституція"}),
			codeBlock("python", "year = 1991\nprint(year + 5)")), []int{1},
			para(plain("1991")), para(plain("1996")), para(plain("2001"))),
		withImage(choice("q8", 1, doc(
			rich.Node{Type: "paragraph", Content: []rich.Node{plain("Подивіться на схему й послухайте звук. Скільки фігур на схемі?")}},
			rich.Node{Type: "image", Attrs: &rich.Attrs{Src: pic, W: diagramW, H: diagramH}},
			rich.Node{Type: "audio", Attrs: &rich.Attrs{Src: sound}}), []int{1},
			para(plain("2")), para(plain("3")), para(plain("4"))), 1, testfmt.Image{Src: pic, W: diagramW, H: diagramH}),
	}}
}

// withImage shows img with option i of q.
func withImage(q testfmt.Question, i int, img testfmt.Image) testfmt.Question {
	q.Options[i].Image = &img
	return q
}

// storeMedia saves the sample image and audio in ms and returns their names.
func storeMedia(ms *media.Store) (pic, sound string, err error) {
	png, err := diagram()
	if err != nil {
		return "", "", err
	}
	if pic, err = ms.Put(bytes.NewReader(png)); err != nil {
		return "", "", err
	}
	sound, err = ms.Put(bytes.NewReader(tone()))
	return pic, sound, err
}

// Seed starts a sitting of the eight-question sample test for class 7-Б, of 25
// students, and returns it. It stores the class and the test first, unless an
// earlier run in the same data folder did, and the test's image and audio in
// ms. If a sitting already runs, demo or
// not, it stores and starts nothing and returns that sitting.
func Seed(st *store.Store, eng *sitting.Engine, ms *media.Store) (wire.SittingInfo, error) {
	if eng.Active() {
		live, err := eng.Live()
		return live.Sitting, err
	}
	ctx := context.Background()
	// Decode validates the test and makes its rich text canonical, as a save
	// through the teacher API does.
	pic, sound, err := storeMedia(ms)
	if err != nil {
		return wire.SittingInfo{}, err
	}
	raw, err := json.Marshal(sampleTest(testID, pic, sound))
	if err != nil {
		return wire.SittingInfo{}, err
	}
	t, err := testfmt.Decode(raw)
	if err != nil {
		return wire.SittingInfo{}, err
	}
	doc, err := json.Marshal(t)
	if err != nil {
		return wire.SittingInfo{}, err
	}
	now := time.Now().UnixMilli()
	err = st.Tx(ctx, func(q *db.Queries) error {
		if _, err := q.GetClass(ctx, classID); errors.Is(err, sql.ErrNoRows) {
			if err := q.InsertClass(ctx, db.InsertClassParams{ID: classID, Name: className, CreatedAt: now}); err != nil {
				return err
			}
			for _, name := range students {
				p := db.InsertStudentParams{ID: store.NewID(), ClassID: classID, Name: name, SortKey: roster.SortKey(name)}
				if err := q.InsertStudent(ctx, p); err != nil {
					return err
				}
			}
		} else if err != nil {
			return err
		}
		if _, err := q.GetTest(ctx, testID); !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		return q.InsertTest(ctx, db.InsertTestParams{ID: testID, Title: t.Title, Doc: string(doc), CreatedAt: now, UpdatedAt: now})
	})
	if err != nil {
		return wire.SittingInfo{}, err
	}
	class := classID
	return eng.Start(testID, &class)
}
