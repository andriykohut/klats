//go:build load

package sitting

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/andriykohut/klats/internal/events"
	"github.com/andriykohut/klats/internal/grading"
	"github.com/andriykohut/klats/internal/store/db"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

// TestLoad runs a lesson at full size, through `make load`: for a minute, 40
// students each send 30 answer changes in batches of 3 and heartbeat every
// 5 s, over a test with one question of each of the 15 types, while the
// teacher's live view refreshes 4 times a second and the offline check ticks
// every 2 s, as the program runs them. Two students write open answers of
// 5,000 characters. Every answer with its last seq must be stored and judged
// by its type, no call may fail, and the p95 of Live must stay under 50 ms.
func TestLoad(t *testing.T) {
	const (
		students   = 40
		batches    = 10
		perBatch   = 3
		longWriter = 2 // the first students write the 5,000-character answers
		lesson     = 60 * time.Second
		liveEvery  = 250 * time.Millisecond // liveDebounce: the teacher refetches at most this often
		beatEvery  = 5 * time.Second
		maxLiveP95 = 50 * time.Millisecond
	)
	st := openStore(t)
	kinds := loadKinds()
	questions := len(kinds)
	qs := make([]testfmt.Question, questions)
	for i, k := range kinds {
		qs[i] = k.question
	}
	raw, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Підсумковий тест", Palette: "teal", Questions: qs})
	if err != nil {
		t.Fatal(err)
	}
	// Decode validates the questions, so an answer rule that drifts from a
	// question fails here and not as a rejected change.
	test, err := testfmt.Decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := json.Marshal(test)
	if err != nil {
		t.Fatal(err)
	}
	qs = test.Questions
	openAt := slices.IndexFunc(qs, func(q testfmt.Question) bool { return q.Type == "open" })
	if err := st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t1", Title: "Підсумковий тест", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
	names := make([]string, students)
	for i := range names {
		names[i] = fmt.Sprintf("Учень %02d", i+1)
	}
	e, err := New(st, events.New(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	info := start(t, e, addClass(t, st, names...))
	devices := make([]string, students)
	var list wire.JoinInfo
	for i := range devices {
		devices[i] = fmt.Sprintf("load%022d", i)
		list = join(t, e, info.Code, devices[i], fmt.Sprintf("10.0.0.%d", i+10))
	}
	pids := make([]string, students)
	for i, n := range list.Names {
		pids[i] = pick(t, e, info.Code, devices[i], wire.PickRequest{StudentID: n.StudentID}).ID
	}

	var (
		mu   sync.Mutex
		errs []error
		took = map[string][]time.Duration{}
	)
	record := func(kind string, from time.Time, err error) {
		d := time.Since(from)
		mu.Lock()
		defer mu.Unlock()
		took[kind] = append(took[kind], d)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", kind, err))
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), lesson)
	defer cancel()
	every := func(d time.Duration, f func()) {
		tick := time.NewTicker(d)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				f()
			}
		}
	}

	var wg sync.WaitGroup
	wg.Go(func() {
		every(liveEvery, func() {
			from := time.Now()
			_, err := e.Live()
			record("live", from, err)
		})
	})
	wg.Go(func() { every(2*time.Second, e.Tick) })
	last := make([]map[string]wire.AnswerChange, students) // per student: question id → last change
	for i := range students {
		last[i] = map[string]wire.AnswerChange{}
		wg.Go(func() {
			r := rand.New(rand.NewPCG(uint64(i), 1))
			time.Sleep(time.Duration(r.Int64N(int64(beatEvery))))
			every(beatEvery, func() {
				from := time.Now()
				s, err := e.Heartbeat(devices[i], 0)
				if err == nil && s.State != statusWriting {
					err = fmt.Errorf("status %q", s.State)
				}
				record("heartbeat", from, err)
			})
		})
		wg.Go(func() {
			r := rand.New(rand.NewPCG(uint64(i), 2))
			gap := lesson / batches
			time.Sleep(time.Duration(r.Int64N(int64(gap))))
			seq := map[string]int64{}
			for b := range batches {
				// The device's queue holds one pending change per question.
				picked := r.Perm(questions)[:perBatch]
				if i < longWriter && !slices.Contains(picked, openAt) {
					picked[0] = openAt
				}
				var changes []wire.AnswerChange
				for _, qi := range picked {
					q := qs[qi].ID
					seq[q]++
					c := wire.AnswerChange{
						ChangeID: fmt.Sprintf("%s-%d-%d", devices[i], b, qi), ParticipantID: pids[i],
						QuestionID: q, Answer: kinds[qi].answer(r, qs[qi], i < longWriter), Seq: seq[q],
					}
					changes = append(changes, c)
					last[i][q] = c
				}
				from := time.Now()
				res, err := e.Submit(devices[i], changes, 0)
				if err == nil && (res.Rejected > 0 || len(res.Acks) != len(changes)) {
					err = fmt.Errorf("%d of %d acked, %d rejected", len(res.Acks), len(changes), res.Rejected)
				}
				record("submit", from, err)
				if b < batches-1 {
					time.Sleep(gap)
				}
			}
		})
	}
	wg.Wait()

	for _, kind := range []string{"live", "submit", "heartbeat"} {
		ds := slices.Sorted(slices.Values(took[kind]))
		t.Logf("%-9s %4d calls  p50 %8v  p95 %8v  max %8v", kind, len(ds),
			percentile(ds, 0.50), percentile(ds, 0.95), ds[len(ds)-1])
	}
	if len(errs) > 0 {
		t.Fatalf("%d calls failed; the first: %v", len(errs), errs[0])
	}
	if p95 := percentile(slices.Sorted(slices.Values(took["live"])), 0.95); p95 >= maxLiveP95 {
		t.Errorf("Live p95 = %v, want under %v", p95, maxLiveP95)
	}

	stored, err := st.Q().ListAnswers(context.Background(), info.SittingID)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]db.Answer{}
	for _, a := range stored {
		got[a.ParticipantID+"/"+a.QuestionID] = a
	}
	want := 0
	for i, changes := range last {
		for q, c := range changes {
			want++
			ids, _ := json.Marshal(c.Answer)
			if a, ok := got[pids[i]+"/"+q]; !ok || a.Seq != c.Seq || a.Value != string(ids) {
				t.Errorf("student %d, %s: stored %+v, want seq %d with %s", i, q, a, c.Seq, ids)
			}
		}
	}
	if len(stored) != want {
		t.Errorf("%d answers stored, want %d", len(stored), want)
	}
	t.Logf("%d answers stored from %d changes", len(stored), students*batches*perBatch)

	byID := map[string]testfmt.Question{}
	for _, q := range qs {
		byID[q.ID] = q
	}
	type judged struct {
		stored   int
		scored   bool // some answer earned points
		longest  int  // characters of the longest text
		longOnes int  // answers of openRunes characters
	}
	perType := map[string]*judged{}
	for _, a := range stored {
		q := byID[a.QuestionID]
		var ans testfmt.Answer
		if err := json.Unmarshal([]byte(a.Value), &ans); err != nil {
			t.Fatal(err)
		}
		j := perType[q.Type]
		if j == nil {
			j = &judged{}
			perType[q.Type] = j
		}
		j.stored++
		n := utf8.RuneCountInString(ans.Text)
		j.longest = max(j.longest, n)
		if n == openRunes {
			j.longOnes++
		}
		v := grading.Judge(q, ans)
		if v.Points < 0 || v.Points > float64(q.Points) {
			t.Errorf("%s answer scored %v of %d", q.Type, v.Points, q.Points)
		}
		if q.Type == "open" {
			if !grading.IsPending(q, ans, false) {
				t.Errorf("open answer %q is not waiting for the teacher", ans.Text)
			}
			continue
		}
		if len(v.Items) == 0 {
			t.Errorf("%s answer %s has no verdict", q.Type, a.Value)
		}
		j.scored = j.scored || v.Points > 0
	}
	for _, q := range qs {
		j := perType[q.Type]
		if j == nil {
			t.Errorf("no %s answer stored", q.Type)
			continue
		}
		t.Logf("%-9s %3d answers stored", q.Type, j.stored)
		switch {
		case q.Type == "open" && j.longOnes != longWriter:
			t.Errorf("%d open answers of %d characters, want %d", j.longOnes, openRunes, longWriter)
		case q.Type != "open" && !j.scored:
			t.Errorf("no %s answer earned points", q.Type)
		}
	}
}

// percentile returns the p-th percentile of the sorted durations ds, by the
// nearest-rank method.
func percentile(ds []time.Duration, p float64) time.Duration {
	return ds[int(math.Ceil(p*float64(len(ds))))-1]
}

// openRunes is the length of a long written answer.
const openRunes = 5000

// loadKind is a question of the load test and the way a student answers it.
type loadKind struct {
	question testfmt.Question
	// answer returns a valid answer to the question, varied by r. A written
	// answer has openRunes characters when long is set.
	answer func(r *rand.Rand, q testfmt.Question, long bool) testfmt.Answer
}

// loadKinds returns one question of each type, worth 2 points with partial
// credit where the type has it. Every answer is valid for its question, and
// some earn points.
func loadKinds() []loadKind {
	// picture is a media name; the sitting engine never opens it.
	picture := &testfmt.Image{Src: strings.Repeat("ab", 32) + ".png", W: 800, H: 600}
	gappedBody := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"text","text":"Столиця України — "},{"type":"gap","attrs":{"id":"g1"}},` +
		`{"type":"text","text":", а байт містить "},{"type":"gap","attrs":{"id":"g2"}},{"type":"text","text":" бітів."}]}]}`)
	markedBody := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"text","text":"Сонце світить "},{"type":"text","text":"яскраво","marks":[{"type":"target"}]},` +
		`{"type":"text","text":", а вітер дме "},{"type":"text","text":"холодно","marks":[{"type":"target"}]},{"type":"text","text":"."}]}]}`)

	// options returns n options o0, o1, … of which the ones at correct are
	// right, and under puts options under the targets t0, t1, … in turn.
	options := func(n int, correct ...int) []testfmt.Option {
		var os []testfmt.Option
		for i := range n {
			os = append(os, testfmt.Option{ID: fmt.Sprintf("o%d", i), Content: rich("варіант"), Correct: slices.Contains(correct, i)})
		}
		return os
	}
	under := func(os []testfmt.Option, targets int) []testfmt.Option {
		for i := range os {
			os[i].Target = fmt.Sprintf("t%d", i%targets)
		}
		return os
	}
	// targets returns n targets t0, t1, … spread along a picture.
	targets := func(n int) []testfmt.Target {
		var ts []testfmt.Target
		for i := range n {
			ts = append(ts, testfmt.Target{ID: fmt.Sprintf("t%d", i), Content: rich("цільовий"), X: float64(i+1) / float64(n+1), Y: 0.5})
		}
		return ts
	}
	question := func(typ string, fill func(q *testfmt.Question)) testfmt.Question {
		q := testfmt.Question{ID: "q-" + typ, Type: typ, Text: rich("Питання"), Points: 2, Partial: true}
		fill(&q)
		return q
	}

	type answerer = func(r *rand.Rand, q testfmt.Question, long bool) testfmt.Answer
	// picks answers with atLeast to atMost of ids, chosen and ordered at random.
	picks := func(atLeast, atMost int, ids ...string) answerer {
		return func(r *rand.Rand, _ testfmt.Question, _ bool) testfmt.Answer {
			a := testfmt.Answer{}
			for _, i := range r.Perm(len(ids))[:atLeast+r.IntN(atMost-atLeast+1)] {
				a.Items = append(a.Items, ids[i])
			}
			return a
		}
	}
	// typed answers with one of texts.
	typed := func(texts ...string) answerer {
		return func(r *rand.Rand, _ testfmt.Question, _ bool) testfmt.Answer {
			return testfmt.Answer{Text: texts[r.IntN(len(texts))]}
		}
	}
	// mapped maps each of keys to one of values; with distinct, no value twice.
	mapped := func(distinct bool, values []string, keys ...string) answerer {
		return func(r *rand.Rand, _ testfmt.Question, _ bool) testfmt.Answer {
			m := map[string]string{}
			order := r.Perm(len(values))
			for i, k := range keys {
				if distinct {
					m[k] = values[order[i]]
				} else {
					m[k] = values[r.IntN(len(values))]
				}
			}
			return testfmt.Answer{Pairs: m}
		}
	}
	return []loadKind{
		{question("single", func(q *testfmt.Question) { q.Options = options(4, 0) }), picks(1, 1, "o0", "o1", "o2", "o3")},
		{question("multi", func(q *testfmt.Question) { q.Options = options(4, 0, 1) }), picks(1, 4, "o0", "o1", "o2", "o3")},
		{question("truefalse", func(q *testfmt.Question) { q.Options = options(3, 0, 2) }),
			mapped(false, []string{"true", "false"}, "o0", "o1", "o2")},
		{question("grid", func(q *testfmt.Question) { q.Targets, q.Options = targets(3), under(options(4), 3) }),
			mapped(false, []string{"t0", "t1", "t2"}, "o0", "o1", "o2", "o3")},
		{question("short", func(q *testfmt.Question) { q.Accepted = []string{"Київ"} }), typed("Київ", "київ", "Львів")},
		{question("number", func(q *testfmt.Question) {
			q.Number = &testfmt.NumberKey{Mode: "tolerance", Value: 9.8, Tolerance: 0.1}
		}), typed("9,8", "9.81", "10")},
		{question("gaps", func(q *testfmt.Question) {
			q.Body = gappedBody
			q.Gaps = []testfmt.Gap{
				{ID: "g1", Accepted: []string{"Київ"}},
				{ID: "g2", Choices: []testfmt.Choice{{ID: "c1", Text: "4"}, {ID: "c2", Text: "8", Correct: true}}},
			}
		}), func(r *rand.Rand, _ testfmt.Question, _ bool) testfmt.Answer {
			return testfmt.Answer{Pairs: map[string]string{"g1": []string{"Київ", "Харків"}[r.IntN(2)], "g2": fmt.Sprintf("c%d", 1+r.IntN(2))}}
		}},
		{question("order", func(q *testfmt.Question) { q.Options = options(4) }), func(r *rand.Rand, _ testfmt.Question, _ bool) testfmt.Answer {
			a := testfmt.Answer{}
			for _, i := range r.Perm(4) {
				a.Items = append(a.Items, fmt.Sprintf("o%d", i))
			}
			return a
		}},
		// Three left items go to the first three of four right-hand cards; the
		// fourth is a decoy.
		{question("match", func(q *testfmt.Question) { q.Targets, q.Options = targets(4), under(options(3), 3) }),
			mapped(true, []string{"t0", "t1", "t2", "t3"}, "o0", "o1", "o2")},
		{question("groups", func(q *testfmt.Question) { q.Targets, q.Options = targets(2), under(options(5), 2) }),
			mapped(false, []string{"t0", "t1"}, "o0", "o1", "o2", "o3", "o4")},
		{question("bank", func(q *testfmt.Question) {
			q.Body = gappedBody
			q.Options = options(3)
			q.Options[0].Target, q.Options[1].Target = "g1", "g2"
		}), mapped(true, []string{"o0", "o1", "o2"}, "g1", "g2")},
		{question("hotspot", func(q *testfmt.Question) {
			q.Image = picture
			q.Areas = []testfmt.Area{{ID: "a0", Shape: "rect", X: 0, Y: 0, W: 0.5, H: 1}}
		}), func(r *rand.Rand, _ testfmt.Question, _ bool) testfmt.Answer {
			return testfmt.Answer{Point: &testfmt.Point{X: r.Float64(), Y: r.Float64()}}
		}},
		// Two labels belong on the picture's two points; the third is a decoy.
		{question("label", func(q *testfmt.Question) {
			q.Image, q.Targets, q.Options = picture, targets(2), options(3)
			q.Options[0].Target, q.Options[1].Target = "t0", "t1"
		}), mapped(true, []string{"t0", "t1"}, "o0", "o1")},
		{question("highlight", func(q *testfmt.Question) { q.Body = markedBody }), func(r *rand.Rand, q testfmt.Question, _ bool) testfmt.Answer {
			_, words := q.Words()
			ids := make([]string, len(words))
			for i := range ids {
				ids[i] = strconv.Itoa(i)
			}
			return picks(1, len(ids), ids...)(r, q, false)
		}},
		{question("open", func(q *testfmt.Question) { q.Rubric = "Світло розсіюється в атмосфері." }), func(r *rand.Rand, _ testfmt.Question, long bool) testfmt.Answer {
			if long {
				return testfmt.Answer{Text: strings.Repeat("Клац ", openRunes/5)}
			}
			return testfmt.Answer{Text: "Блакитне світло розсіюється найсильніше."}
		}},
	}
}
