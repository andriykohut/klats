// Package demo fills a data folder with a lesson in progress, so a newcomer
// can try both apps at once: `klats -dev -demo` seeds it and prints where to
// open them. It writes through the store and the sitting engine, as the
// teacher API would, and never runs in a normal launch.
package demo

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"klats/internal/rich"
	"klats/internal/roster"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

const className = "7-Б"

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

// sampleTest is six questions, single and multiple choice, with bold, sub- and
// superscript text.
func sampleTest(id string) testfmt.Test {
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
		choice("q6", 1, para(plain("Яка площа квадрата зі стороною 3 см?")), []int{1},
			para(plain("6 см"), sup("2")), para(plain("9 см"), sup("2")), para(plain("12 см"), sup("2"))),
	}}
}

// Seed stores class 7-Б of 25 students and a six-question sample test, then
// starts a sitting of that test for the class and returns it. If a sitting
// already runs, it stores nothing and returns [sitting.ErrSittingActive].
func Seed(st *store.Store, eng *sitting.Engine) (wire.SittingInfo, error) {
	if eng.Active() {
		return wire.SittingInfo{}, sitting.ErrSittingActive
	}
	ctx := context.Background()
	classID, testID := store.NewID(), store.NewID()
	// Decode validates the test and makes its rich text canonical, as a save
	// through the teacher API does.
	raw, err := json.Marshal(sampleTest(testID))
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
		if err := q.InsertClass(ctx, db.InsertClassParams{ID: classID, Name: className, CreatedAt: now}); err != nil {
			return err
		}
		for _, name := range students {
			p := db.InsertStudentParams{ID: store.NewID(), ClassID: classID, Name: name, SortKey: roster.SortKey(name)}
			if err := q.InsertStudent(ctx, p); err != nil {
				return err
			}
		}
		return q.InsertTest(ctx, db.InsertTestParams{ID: testID, Title: t.Title, Doc: string(doc), CreatedAt: now, UpdatedAt: now})
	})
	if err != nil {
		return wire.SittingInfo{}, err
	}
	return eng.Start(testID, &classID)
}
