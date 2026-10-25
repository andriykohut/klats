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

// trueFalse returns a question worth points whose statements are true where
// right says so.
func trueFalse(id string, points int, text json.RawMessage, right []bool, statements ...json.RawMessage) testfmt.Question {
	q := testfmt.Question{ID: id, Type: "truefalse", Text: text, Points: points, Partial: true}
	for i, content := range statements {
		q.Options = append(q.Options, testfmt.Option{ID: fmt.Sprintf("%so%d", id, i), Content: content, Correct: right[i]})
	}
	return q
}

// gridRow is a row of a choice grid and the index of its right column.
type gridRow struct {
	content json.RawMessage
	column  int
}

// grid returns a choice-grid question worth points, with a column for each of
// columns and the rows given.
func grid(id string, points int, text json.RawMessage, columns []json.RawMessage, rows ...gridRow) testfmt.Question {
	q := testfmt.Question{ID: id, Type: "grid", Text: text, Points: points, Partial: true}
	for i, content := range columns {
		q.Targets = append(q.Targets, testfmt.Target{ID: fmt.Sprintf("%sc%d", id, i), Content: content})
	}
	for i, r := range rows {
		q.Options = append(q.Options, testfmt.Option{ID: fmt.Sprintf("%so%d", id, i), Content: r.content, Target: q.Targets[r.column].ID})
	}
	return q
}

// shortAnswer returns a one-point question answered by typing one of accepted.
func shortAnswer(id string, text json.RawMessage, accepted ...string) testfmt.Question {
	return testfmt.Question{ID: id, Type: "short", Text: text, Points: 1, Accepted: accepted}
}

// numberAnswer returns a one-point question whose answer is value, give or
// take tolerance.
func numberAnswer(id string, text json.RawMessage, value, tolerance float64) testfmt.Question {
	return testfmt.Question{ID: id, Type: "number", Text: text, Points: 1, Number: &testfmt.NumberKey{Mode: "tolerance", Value: value, Tolerance: tolerance}}
}

// gap is the place in a gaps body where the gap with the given id goes.
func gap(id string) rich.Node { return rich.Node{Type: "gap", Attrs: &rich.Attrs{ID: id}} }

// sampleTest is seventeen questions, single and multiple choice, with bold,
// sub- and superscript text, formulas in the text and options of the sixth, a
// table and a code block in the seventh, and the stored image pic and audio
// sound in the eighth, then a true/false question with a picture beside one
// statement, a choice grid, a short answer, a number and a gaps question with a
// formula, a typed gap and a list gap, then an ordering, a matching, a grouping
// (with a picture on one item) and a word bank question.
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
		withImage(trueFalse("q9", 2, para(plain("Які з цих тверджень правдиві?")), []bool{true, false, true, true},
			para(plain("Байт складається з 8 бітів")), para(plain("Монітор є пристроєм введення")),
			para(plain("Firefox є браузером")), para(plain("На схемі є зелене коло"))), 3, testfmt.Image{Src: pic, W: diagramW, H: diagramH}),
		grid("q10", 3, para(plain("До якого типу належить кожен пристрій?")),
			[]json.RawMessage{para(plain("Введення")), para(plain("Виведення"))},
			gridRow{para(plain("Клавіатура")), 0}, gridRow{para(plain("Монітор")), 1},
			gridRow{para(plain("Мишка")), 0}, gridRow{para(plain("Принтер")), 1}),
		shortAnswer("q11", para(plain("Яка столиця України?")), "Київ", "м. Київ"),
		numberAnswer("q12", para(plain("Чому дорівнює прискорення вільного падіння, у м/с"), sup("2"), plain("?")), 9.8, 0.1),
		{ID: "q13", Type: "gaps", Points: 3, Partial: true, Text: para(plain("Заповніть пропуски.")),
			Body: doc(rich.Node{Type: "paragraph", Content: []rich.Node{
				plain("Якщо "), formula(`x+3=5`), plain(", то x дорівнює "), gap("g1"),
				plain(". Столиця України — "), gap("g2"), plain(", а байт містить "), gap("g3"), plain(" бітів.")}}),
			Gaps: []testfmt.Gap{
				{ID: "g1", Accepted: []string{"2", "два"}},
				{ID: "g2", Accepted: []string{"Київ"}},
				{ID: "g3", Choices: []testfmt.Choice{{ID: "c1", Text: "4"}, {ID: "c2", Text: "8", Correct: true}, {ID: "c3", Text: "16"}}},
			}},
		ordering("q14", 3, para(plain("Розташуйте етапи розв’язування задачі в правильному порядку.")),
			para(plain("Прочитати умову")), para(plain("Скласти план")), para(plain("Виконати обчислення")), para(plain("Перевірити відповідь"))),
		matching("q15", 3, para(plain("З’єднайте країни зі столицями.")),
			[]json.RawMessage{para(plain("Київ")), para(plain("Варшава")), para(plain("Берлін")), para(plain("Париж"))},
			pair{para(plain("Україна")), 0}, pair{para(plain("Польща")), 1}, pair{para(plain("Німеччина")), 2}),
		withImage(grouping("q16", 4, para(plain("Розкладіть пристрої за групами.")),
			[]json.RawMessage{para(plain("Введення")), para(plain("Виведення"))},
			pair{para(plain("Клавіатура")), 0}, pair{para(plain("Мишка")), 0}, pair{para(plain("Монітор")), 1},
			pair{para(plain("Принтер")), 1}, pair{para(plain("Колонки")), 1}), 2, testfmt.Image{Src: pic, W: diagramW, H: diagramH}),
		{ID: "q17", Type: "bank", Points: 3, Partial: true, Text: para(plain("Вставте слова в текст.")),
			Body: doc(rich.Node{Type: "paragraph", Content: []rich.Node{
				plain("Значення "), formula(`2^3`), plain(" дорівнює "), gap("g1"),
				plain(". Столиця України — "), gap("g2"), plain(". Вісім бітів утворюють "), gap("g3"), plain(".")}}),
			Options: []testfmt.Option{
				{ID: "q17o0", Content: para(plain("8")), Target: "g1"},
				{ID: "q17o1", Content: para(plain("Київ")), Target: "g2"},
				{ID: "q17o2", Content: para(plain("байт")), Target: "g3"},
				{ID: "q17o3", Content: para(plain("16"))},
				{ID: "q17o4", Content: para(plain("Львів"))},
			}},
	}}
}

// pair is a left-hand item of a matching or grouping question and the index
// of its right-hand card or group.
type pair struct {
	content json.RawMessage
	target  int
}

// ordering returns a question worth points whose items are in the right order
// as given.
func ordering(id string, points int, text json.RawMessage, items ...json.RawMessage) testfmt.Question {
	q := testfmt.Question{ID: id, Type: "order", Text: text, Points: points, Partial: true}
	for i, content := range items {
		q.Options = append(q.Options, testfmt.Option{ID: fmt.Sprintf("%so%d", id, i), Content: content})
	}
	return q
}

// matching returns a question worth points with a left-hand item for each of
// pairs and the cards as its right-hand side, one of which is a decoy.
func matching(id string, points int, text json.RawMessage, cards []json.RawMessage, pairs ...pair) testfmt.Question {
	return arranged("match", id, points, text, cards, pairs)
}

// grouping returns a question worth points with a group for each of groups
// and the items given.
func grouping(id string, points int, text json.RawMessage, groups []json.RawMessage, items ...pair) testfmt.Question {
	return arranged("groups", id, points, text, groups, items)
}

func arranged(typ, id string, points int, text json.RawMessage, targets []json.RawMessage, options []pair) testfmt.Question {
	q := testfmt.Question{ID: id, Type: typ, Text: text, Points: points, Partial: true}
	for i, content := range targets {
		q.Targets = append(q.Targets, testfmt.Target{ID: fmt.Sprintf("%st%d", id, i), Content: content})
	}
	for i, o := range options {
		q.Options = append(q.Options, testfmt.Option{ID: fmt.Sprintf("%so%d", id, i), Content: o.content, Target: q.Targets[o.target].ID})
	}
	return q
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

// Seed starts a sitting of the seventeen-question sample test for class 7-Б, of 25
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
