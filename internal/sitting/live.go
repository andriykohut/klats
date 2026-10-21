package sitting

import (
	"cmp"
	"database/sql"
	"encoding/json"
	"log/slog"
	"math"
	"slices"
	"strings"

	"klats/internal/roster"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

// Live cells, as in [wire.LiveRow].
const (
	cellCorrect = "correct"
	cellWrong   = "wrong"
	cellCurrent = "current"
	cellEmpty   = "empty"
)

// snapshotsKeep is how many snapshots taken at the end of a sitting are kept.
const snapshotsKeep = 10

// SetSnapshotDir makes [Engine.End] snapshot the database into
// dir/snapshots. Without it, End takes no snapshot.
func (e *Engine) SetSnapshotDir(dir string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.snapshotDir = dir
}

// Live returns the teacher's view of the running sitting or, until the next
// one starts, of the last ended one, where late answers show. With neither,
// it returns a zero Sitting and no rows.
func (e *Engine) Live() (wire.LiveSnapshot, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := wire.LiveSnapshot{Counts: wire.Counts{NotJoined: []string{}}, Rows: []wire.LiveRow{}, QuestionPct: []*int{}, Events: []wire.Event{}}
	a := cmp.Or(e.cur, e.ended)
	if a == nil {
		return out, nil
	}
	q := e.st.Q()
	devices, err := q.ListDeviceLabels(ctx, a.sitting.ID)
	if err != nil {
		return wire.LiveSnapshot{}, err
	}
	labels := make(map[string]string, len(devices))
	for _, d := range devices {
		labels[d.Token] = d.Label
	}

	out.Sitting = a.info()
	n := len(a.test.Questions)
	answered, full := make([]int, n), make([]int, n)
	for _, p := range a.participants {
		if p.state == stateKicked {
			continue
		}
		r := a.grade(p)
		row := wire.LiveRow{ParticipantID: p.id, Name: p.name, DeviceToken: p.device, DeviceLabel: labels[p.device], Cells: make([]string, n), Status: p.state, WindowSwitches: p.switches}
		last := -1
		for i, question := range a.test.Questions {
			row.Cells[i] = cellEmpty
			if len(p.answers[question.ID]) == 0 {
				continue
			}
			last = i
			answered[i]++
			row.Cells[i] = cellWrong
			if fullPoints(question, r.PerQuestion[question.ID]) {
				full[i]++
				row.Cells[i] = cellCorrect
			}
		}
		if p.state == stateWriting && last+1 < n {
			row.Cells[last+1] = cellCurrent
		}
		switch {
		case p.state == stateFinished:
			out.Counts.Finished++
			row.Grade = &r.Grade
		case p.offline:
			out.Counts.Offline++
			row.Status = statusOffline
		}
		out.Rows = append(out.Rows, row)
	}
	out.Counts.InTest = len(out.Rows)
	byName(out.Rows, func(r wire.LiveRow) string { return r.Name })
	for i := range n {
		var pct *int
		if answered[i] > 0 {
			v := int(math.Round(100 * float64(full[i]) / float64(answered[i])))
			pct = &v
		}
		out.QuestionPct = append(out.QuestionPct, pct)
	}

	if a.assignment.ClassID.Valid {
		names, err := e.classList(q)
		if err != nil {
			return wire.LiveSnapshot{}, err
		}
		out.Counts.ClassSize = len(names)
		for _, s := range names {
			if a.holder(s.StudentID) == nil {
				out.Counts.NotJoined = append(out.Counts.NotJoined, s.Name)
			}
		}
	}

	pinned, err := q.ListOpenPinnedEvents(ctx, a.sitting.ID)
	if err != nil {
		return wire.LiveSnapshot{}, err
	}
	recent, err := q.ListRecentEvents(ctx, a.sitting.ID)
	if err != nil {
		return wire.LiveSnapshot{}, err
	}
	for _, ev := range slices.Concat(pinned, recent) {
		w := wire.Event{ID: ev.ID, Kind: ev.Kind, At: ev.CreatedAt, Pinned: ev.Pinned == 1 && !ev.ResolvedAt.Valid, Actions: []string{}}
		if err := json.Unmarshal([]byte(ev.Params), &w.Params); err != nil {
			return wire.LiveSnapshot{}, err
		}
		if w.Pinned && ev.Kind == kindNameClash {
			w.Actions = ClashActions
		}
		out.Events = append(out.Events, w)
	}
	return out, nil
}

// End ends the running sitting: participants still writing are finished as
// they stand, unanswered questions scoring zero, and every device of the
// sitting is told. Students who were offline may still deliver answers, see
// [Engine.Submit]; [Engine.Live] shows the ended sitting until the next one
// starts. When a snapshot directory is set, End then snapshots the
// database; a failed snapshot is logged and does not fail End. It returns
// [ErrNotFound] when no sitting runs.
func (e *Engine) End() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	a := e.cur
	if a == nil {
		return ErrNotFound
	}
	at := sql.NullInt64{Int64: e.now().UnixMilli(), Valid: true}
	err := e.commit(func(q *db.Queries) (func(), error) {
		var writing []*participant
		for _, p := range a.participants {
			if p.state != stateWriting {
				continue
			}
			if err := q.FinishParticipant(ctx, db.FinishParticipantParams{FinishedBy: valid(finishedByEnd), FinishedAt: at, ID: p.id}); err != nil {
				return nil, err
			}
			writing = append(writing, p)
		}
		if err := q.EndSitting(ctx, db.EndSittingParams{EndedAt: at, ID: a.sitting.ID}); err != nil {
			return nil, err
		}
		return func() {
			for _, p := range writing {
				p.state, p.finishedBy, p.finishedAt = stateFinished, finishedByEnd, at.Int64
			}
			a.sitting.EndedAt = at
			e.cur, e.ended = nil, a
			for device := range a.status {
				e.publishStatus(device)
			}
		}, nil
	})
	if err != nil {
		return err
	}
	if e.snapshotDir != "" {
		if err := e.st.Snapshot(e.snapshotDir, snapshotsKeep); err != nil {
			slog.Error("sitting: snapshot after the end", "err", err)
		}
	}
	return nil
}

// fullPoints reports whether pts are the question's full points, allowing for
// float error in partial scores.
func fullPoints(q testfmt.Question, pts float64) bool {
	return math.Abs(pts-float64(q.Points)) < 1e-9
}

// byName sorts rows into Ukrainian order of their names, keeping the order of
// equal names.
func byName[T any](rows []T, name func(T) string) {
	keys := make(map[string]string, len(rows))
	for _, r := range rows {
		keys[name(r)] = roster.SortKey(name(r))
	}
	slices.SortStableFunc(rows, func(a, b T) int { return strings.Compare(keys[name(a)], keys[name(b)]) })
}
