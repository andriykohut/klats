package sitting

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"strconv"
	"time"

	"klats/internal/grading"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

const (
	// maxChanges caps the changes in one Submit call, maxPicks the option ids
	// in one change and maxChangeID the length of a change id in bytes.
	maxChanges  = 200
	maxPicks    = 20
	maxChangeID = 64

	// offlineAfter is how long a writing participant's device may stay silent
	// before the teacher is told it is offline.
	offlineAfter = 15 * time.Second
)

// delivery is a change that was stored.
type delivery struct {
	a        *active
	p        *participant
	question string
	options  []string
}

// Submit stores the device's answer changes and returns their acks with the
// device's status. A change is stored only when its seq is higher than the
// seq stored for its participant and question; a lower or equal seq and a
// change id already seen are acked and ignored, as are changes from a
// participant who finished on their own.
//
// The device may send changes for the participant it writes as, and for
// participants moved off it to another device. Changes for anyone else, and
// malformed changes (a missing or over-long change id, a seq below 1, an
// unknown question, an option of another question, more than 20 option ids)
// are acked but counted in Rejected.
// After the sitting has ended, changes from participants it finished are still
// stored, flagged late: the participant is regraded, a late_answers event is
// raised and the assignment's export is marked stale.
//
// It returns [ErrInvalid] for more than 200 changes and [ErrKicked] if the
// teacher sent the device back to the name picker.
func (e *Engine) Submit(device string, changes []wire.AnswerChange) (wire.SubmitResult, error) {
	if len(changes) > maxChanges {
		return wire.SubmitResult{}, ErrInvalid
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur != nil && e.cur.status[device] == statusKicked {
		return wire.SubmitResult{}, ErrKicked
	}
	res := wire.SubmitResult{Acks: []string{}}
	if len(changes) > 0 {
		err := e.commit(func(q *db.Queries) (func(), error) { return e.deliver(q, device, changes, &res.Rejected) })
		if err != nil {
			return wire.SubmitResult{}, err
		}
		for _, c := range changes {
			res.Acks = append(res.Acks, c.ChangeID)
		}
	}
	if err := e.touch(device); err != nil {
		return wire.SubmitResult{}, err
	}
	var err error
	res.Status, err = e.status(device)
	return res, err
}

// deliver writes the changes that pass Submit's rules, counting refused ones in
// rejected, and returns the in-memory change.
func (e *Engine) deliver(q *db.Queries, device string, changes []wire.AnswerChange, rejected *int) (func(), error) {
	var stored []delivery
	loaded := map[string]*active{} // ended sittings read for this call, by id
	for _, c := range changes {
		a, p, err := e.writer(q, loaded, device, c.ParticipantID)
		if err != nil {
			return nil, err
		}
		var options []string
		ok := p != nil
		if ok {
			options, ok = checkChange(a.test, c)
		}
		if !ok {
			*rejected++
			continue
		}
		if p.finishedBy == finishedByStudent {
			continue
		}
		seen, err := q.ChangeSeen(ctx, c.ChangeID)
		if err != nil {
			return nil, err
		}
		if seen {
			continue
		}
		b, err := json.Marshal(options)
		if err != nil {
			return nil, err
		}
		var late int64
		if a.sitting.EndedAt.Valid {
			late = 1
		}
		n, err := q.UpsertAnswer(ctx, db.UpsertAnswerParams{
			ParticipantID: p.id, QuestionID: c.QuestionID, OptionIds: string(b), Seq: c.Seq,
			ChangeID: c.ChangeID, ReceivedAt: e.now().UnixMilli(), Late: late,
		})
		if err != nil {
			return nil, err
		}
		if n > 0 {
			stored = append(stored, delivery{a, p, c.QuestionID, options})
		}
	}

	lateCount := map[*participant]int{}
	var regraded []delivery // one per participant with late answers
	for _, d := range stored {
		if !d.a.sitting.EndedAt.Valid {
			continue
		}
		if lateCount[d.p] == 0 {
			regraded = append(regraded, d)
		}
		lateCount[d.p]++
	}
	for _, d := range regraded {
		if _, err := e.raise(q, d.a.sitting.ID, "late_answers", map[string]string{"name": d.p.name, "count": strconv.Itoa(lateCount[d.p])}, false); err != nil {
			return nil, err
		}
		if err := q.SetExportStale(ctx, d.a.assignment.ID); err != nil {
			return nil, err
		}
	}
	return func() {
		for _, d := range stored {
			d.p.answers[d.question] = d.options
			if d.p.offline {
				d.p.synced++
			}
		}
		for _, d := range regraded {
			e.publishStatus(d.p.device)
		}
	}, nil
}

// writer returns the participant with the id, and its sitting, if the device
// may send changes for it: it is not kicked, and it writes on the device or
// was moved off it. It returns a nil participant otherwise. A participant of
// an ended sitting is read from the database, through loaded.
func (e *Engine) writer(q *db.Queries, loaded map[string]*active, device, participantID string) (*active, *participant, error) {
	a := e.cur
	var p *participant
	if a != nil {
		p = a.byID(participantID)
	}
	if p == nil {
		row, err := q.GetParticipant(ctx, participantID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil
		}
		if err != nil {
			return nil, nil, err
		}
		if a = loaded[row.SittingID]; a == nil {
			s, err := q.GetSitting(ctx, row.SittingID)
			if err != nil {
				return nil, nil, err
			}
			if a, err = e.loadSitting(q, s); err != nil {
				return nil, nil, err
			}
			loaded[s.ID] = a
		}
		p = a.byID(participantID)
	}
	if p.state == stateKicked || (p.device != device && !slices.Contains(a.movedFrom[device], p.id)) {
		return nil, nil, nil
	}
	return a, p, nil
}

// checkChange returns the change's option ids with repeats dropped, and
// whether the change is well formed for the test: a change id of 1 to 64
// bytes, a seq of at least 1, and a question of the test with at most 20
// option ids, all of that question.
func checkChange(t testfmt.Test, c wire.AnswerChange) ([]string, bool) {
	i := slices.IndexFunc(t.Questions, func(q testfmt.Question) bool { return q.ID == c.QuestionID })
	if c.ChangeID == "" || len(c.ChangeID) > maxChangeID || c.Seq < 1 || i < 0 || len(c.OptionIDs) > maxPicks {
		return nil, false
	}
	options := []string{}
	for _, id := range c.OptionIDs {
		if !slices.ContainsFunc(t.Questions[i].Options, func(o testfmt.Option) bool { return o.ID == id }) {
			return nil, false
		}
		if !slices.Contains(options, id) {
			options = append(options, id)
		}
	}
	return options, true
}

// touch records a request from the device: the participant it writes as in
// the running sitting is seen now and, if it was offline, an online event
// reports the changes stored meanwhile. The caller holds e.mu.
func (e *Engine) touch(device string) error {
	if e.cur == nil {
		return nil
	}
	p := e.cur.onDevice(device)
	if p == nil {
		return nil
	}
	p.lastSeen = e.now()
	if !p.offline {
		return nil
	}
	return e.commit(func(q *db.Queries) (func(), error) {
		_, err := e.raise(q, e.cur.sitting.ID, "online", map[string]string{"name": p.name, "synced": strconv.Itoa(p.synced)}, false)
		return func() { p.offline, p.synced = false, 0 }, err
	})
}

// Heartbeat records that the device is still there and returns its status.
func (e *Engine) Heartbeat(device string) (wire.Status, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.touch(device); err != nil {
		return wire.Status{}, err
	}
	return e.status(device)
}

// status returns the device's status. A device that is not in the running
// sitting is "ended", with its result, if its last participant who was not
// kicked is in an ended sitting, and "unjoined" otherwise. The caller holds
// e.mu.
func (e *Engine) status(device string) (wire.Status, error) {
	if a := e.cur; a != nil {
		switch s := a.status[device]; s {
		case statusKicked, statusMoved:
			return wire.Status{State: s}, nil
		case statusWriting:
			p := a.onDevice(device)
			if p.state != stateFinished {
				return wire.Status{State: statusWriting}, nil
			}
			r := a.finishResult(p)
			return wire.Status{State: statusFinished, Result: &r}, nil
		}
	}
	q := e.st.Q()
	row, err := q.LastEndedParticipantOnDevice(ctx, device)
	if errors.Is(err, sql.ErrNoRows) {
		return wire.Status{State: statusUnjoined}, nil
	}
	if err != nil {
		return wire.Status{}, err
	}
	s, err := q.GetSitting(ctx, row.SittingID)
	if err != nil {
		return wire.Status{}, err
	}
	a, err := e.loadSitting(q, s)
	if err != nil {
		return wire.Status{}, err
	}
	r := a.finishResult(a.byID(row.ID))
	return wire.Status{State: statusEnded, Result: &r}, nil
}

// Finish ends the test for the participant the device writes as, locks its
// answers, raises a finished event and returns the grade. Finishing again, or
// after the sitting ended, returns the grade as it stands. It returns
// [ErrKicked] if the teacher sent the device back to the name picker and
// [ErrNotJoined] if the device has no participant.
func (e *Engine) Finish(device string) (wire.FinishResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.touch(device); err != nil {
		return wire.FinishResult{}, err
	}
	if a := e.cur; a != nil {
		if a.status[device] == statusKicked {
			return wire.FinishResult{}, ErrKicked
		}
		if p := a.onDevice(device); p != nil {
			if p.state == stateWriting {
				if err := e.finish(p); err != nil {
					return wire.FinishResult{}, err
				}
			}
			return a.finishResult(p), nil
		}
	}
	s, err := e.status(device)
	if err != nil {
		return wire.FinishResult{}, err
	}
	if s.Result == nil {
		return wire.FinishResult{}, ErrNotJoined
	}
	return *s.Result, nil
}

func (e *Engine) finish(p *participant) error {
	now := e.now().UnixMilli()
	grade := e.cur.finishResult(p).Grade
	return e.commit(func(q *db.Queries) (func(), error) {
		err := q.FinishParticipant(ctx, db.FinishParticipantParams{FinishedBy: valid(finishedByStudent), FinishedAt: sql.NullInt64{Int64: now, Valid: true}, ID: p.id})
		if err != nil {
			return nil, err
		}
		_, err = e.raise(q, e.cur.sitting.ID, "finished", map[string]string{"name": p.name, "grade": strconv.Itoa(grade)}, false)
		return func() {
			p.state, p.finishedBy, p.finishedAt = stateFinished, finishedByStudent, now
			e.publishStatus(p.device)
		}, err
	})
}

// Focus records that the device's page lost (left) or regained focus. Each
// time a writing participant leaves, its window switch count goes up and a
// window_switch event is raised. Errors are logged, as the device has no use
// for them.
func (e *Engine) Focus(device string, left bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	err := e.touch(device)
	if err == nil && left && e.cur != nil {
		if p := e.cur.onDevice(device); p != nil && p.state == stateWriting {
			n := p.switches + 1
			err = e.commit(func(q *db.Queries) (func(), error) {
				if err := q.SetWindowSwitches(ctx, db.SetWindowSwitchesParams{WindowSwitches: int64(n), ID: p.id}); err != nil {
					return nil, err
				}
				_, err := e.raise(q, e.cur.sitting.ID, "window_switch", map[string]string{"name": p.name, "count": strconv.Itoa(n)}, false)
				return func() { p.switches = n }, err
			})
		}
	}
	if err != nil {
		slog.Error("sitting: record focus", "err", err)
	}
}

// Tick raises one offline event for each writing participant whose device
// has sent nothing for 15 s. The program calls it every 2 s. Errors are
// logged.
func (e *Engine) Tick() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil {
		return
	}
	now := e.now()
	var gone []*participant
	for _, p := range e.cur.participants {
		if p.state == stateWriting && !p.offline && now.Sub(p.lastSeen) >= offlineAfter {
			gone = append(gone, p)
		}
	}
	if len(gone) == 0 {
		return
	}
	err := e.commit(func(q *db.Queries) (func(), error) {
		for _, p := range gone {
			if _, err := e.raise(q, e.cur.sitting.ID, "offline", map[string]string{"name": p.name}, false); err != nil {
				return nil, err
			}
		}
		return func() {
			for _, p := range gone {
				p.offline, p.synced = true, 0
			}
		}, nil
	})
	if err != nil {
		slog.Error("sitting: mark devices offline", "err", err)
	}
}

// grade grades the participant against the sitting's test snapshot.
func (a *active) grade(p *participant) grading.Result {
	return grading.Total(a.test, p.answers, p.overrides)
}

func (a *active) finishResult(p *participant) wire.FinishResult {
	r := a.grade(p)
	return wire.FinishResult{Grade: r.Grade, Correct: r.Correct, Total: len(a.test.Questions)}
}
