package sitting

import (
	"strconv"
	"time"

	"klats/internal/store/db"
	"klats/internal/testfmt"
)

const (
	// lateGrace is how long after its deadline a participant's change still
	// counts as on time: a change made just before the deadline may be in
	// flight, or queued on a device that missed a request.
	lateGrace = 10 * time.Second

	// maxCommonEnd is how far after the start a common end time may be.
	maxCommonEnd = 12 * time.Hour

	// maxExtraMinutes caps the minutes one [Engine.AddTime] gives.
	maxExtraMinutes = 60
)

// deadline returns when the participant's time runs out, in unix ms, extra
// time included, and false for a test without a time limit.
func (a *active) deadline(p *participant) (int64, bool) {
	switch tl := a.test.Settings.TimeLimit; tl.Mode {
	case testfmt.TimeStudent:
		return p.joinedAt + int64(tl.Minutes)*time.Minute.Milliseconds() + p.extraMs, true
	case testfmt.TimeCommon:
		return a.sitting.EndsAt.Int64 + p.extraMs, true
	}
	return 0, false
}

// remainingMs returns the time the participant has left at now, never below
// 0, or nil without a time limit.
func (a *active) remainingMs(p *participant, now time.Time) *int64 {
	d, ok := a.deadline(p)
	if !ok {
		return nil
	}
	ms := max(0, d-now.UnixMilli())
	return &ms
}

// overtime reports whether a change from the participant stored at now
// arrives more than lateGrace after its deadline.
func (a *active) overtime(p *participant, now time.Time) bool {
	d, ok := a.deadline(p)
	return ok && now.UnixMilli() > d+lateGrace.Milliseconds()
}

// AddTime gives the participant minutes more time, raises an extra_time event
// and tells the participant's device its status changed. It returns
// [ErrNotFound] for a participant not in the running sitting, and
// [ErrInvalid] for minutes outside 1-60, a test without a time limit, or a
// participant who is kicked or no longer writing.
func (e *Engine) AddTime(participantID string, minutes int) error {
	if minutes < 1 || minutes > maxExtraMinutes {
		return ErrInvalid
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	p, err := e.participant(participantID)
	if err != nil {
		return err
	}
	if _, timed := e.cur.deadline(p); !timed || p.state != stateWriting {
		return ErrInvalid
	}
	extra := int64(minutes) * time.Minute.Milliseconds()
	return e.commit(func(q *db.Queries) (func(), error) {
		if err := q.AddExtraTime(ctx, db.AddExtraTimeParams{ExtraMs: extra, ID: p.id}); err != nil {
			return nil, err
		}
		_, err := e.raise(q, e.cur.sitting.ID, "extra_time", map[string]string{"name": p.name, "minutes": strconv.Itoa(minutes)}, false)
		return func() {
			p.extraMs += extra
			e.publishStatus(p.device)
		}, err
	})
}
