//go:build load

package sitting

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"slices"
	"sync"
	"testing"
	"time"

	"klats/internal/events"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

// TestLoad runs a lesson at full size, through `make load`: for a minute, 40
// students each send 30 answer changes in batches of 3 and heartbeat every
// 5 s, while the teacher's live view refreshes 4 times a second and the
// offline check ticks every 2 s, as the program runs them. Every answer with
// its last seq must be stored, no call may fail, and the p95 of Live must stay
// under 50 ms.
func TestLoad(t *testing.T) {
	const (
		students   = 40
		questions  = 20
		batches    = 10
		perBatch   = 3
		lesson     = 60 * time.Second
		liveEvery  = 250 * time.Millisecond // liveDebounce: the teacher refetches at most this often
		beatEvery  = 5 * time.Second
		maxLiveP95 = 50 * time.Millisecond
	)
	st := openStore(t)
	qs := make([]testfmt.Question, questions)
	for i := range qs {
		qs[i] = testfmt.Question{ID: fmt.Sprintf("q%d", i+1), Type: "single", Text: rich("Питання"), Points: 1}
		for j := range 4 {
			qs[i].Options = append(qs[i].Options, testfmt.Option{ID: fmt.Sprintf("o%d", j), Content: rich("варіант"), Correct: j == 0})
		}
	}
	doc, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Підсумковий тест", Palette: "teal", Questions: qs})
	if err != nil {
		t.Fatal(err)
	}
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
				var changes []wire.AnswerChange
				for _, qi := range r.Perm(questions)[:perBatch] {
					q := qs[qi].ID
					seq[q]++
					c := wire.AnswerChange{
						ChangeID: fmt.Sprintf("%s-%d-%d", devices[i], b, qi), ParticipantID: pids[i],
						QuestionID: q, Answer: testfmt.Answer{Items: []string{fmt.Sprintf("o%d", r.IntN(4))}}, Seq: seq[q],
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
}

// percentile returns the p-th percentile of the sorted durations ds, by the
// nearest-rank method.
func percentile(ds []time.Duration, p float64) time.Duration {
	return ds[int(math.Ceil(p*float64(len(ds))))-1]
}
