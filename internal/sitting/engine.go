// Package sitting runs a sitting: one live run of a test for a class over the
// school LAN. The Engine holds the running sitting in memory behind a mutex and
// writes every change to SQLite before reporting success, so a restarted
// program resumes the sitting from the database.
//
// A participant is one student's place in a sitting, bound to the device token
// of the browser that picked the name. The name stays locked to that device
// until the teacher kicks the participant or moves it to another device.
package sitting

import (
	"cmp"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"sync"
	"time"

	"klats/internal/events"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

var (
	ErrSittingActive = errors.New("sitting: a sitting is already running")
	ErrBadCode       = errors.New("sitting: wrong join code")
	ErrNotJoined     = errors.New("sitting: device has not joined the sitting")
	ErrHasProblems   = errors.New("sitting: test has blocking problems")
	// ErrNotFound means the test, class, device, participant or pending event
	// does not exist, or no sitting is running.
	ErrNotFound = errors.New("sitting: not found")
	// ErrInvalid means the request is malformed or not allowed in the current
	// state, such as an unknown student or an empty typed name.
	ErrInvalid = errors.New("sitting: invalid request")
	// ErrKicked means the teacher sent the device back to the name picker.
	ErrKicked = errors.New("sitting: device was kicked")
)

// ErrNameTaken is returned by [Engine.Pick] when another device holds the
// name. Label is that device's label.
type ErrNameTaken struct{ Label string }

func (e ErrNameTaken) Error() string { return "sitting: name is taken on device " + e.Label }

// Participant states, as stored in participants.state.
const (
	stateWriting  = "writing"
	stateFinished = "finished"
	stateKicked   = "kicked"
)

// Who finished a participant, as stored in participants.finished_by. A student
// who finished locks their answers. One finished by the end of the sitting may
// still deliver answers late until its device reports none pending, which
// locks it as finishedByEndSynced.
const (
	finishedByStudent   = "student"
	finishedByEnd       = "end"
	finishedByEndSynced = "end_synced"
)

// Device statuses, as returned by [Engine.DeviceStatus].
const (
	statusWriting  = "writing"
	statusKicked   = "kicked"
	statusMoved    = "moved"
	statusUnjoined = "unjoined"
)

// Further states of [wire.Status] and [wire.LiveRow].
const (
	statusFinished = "finished"
	statusEnded    = "ended"
	statusOffline  = "offline"
)

// Actions the teacher can take on a name_clash event.
const (
	ActionKickOld = "kick_old"
	ActionKickNew = "kick_new"
	ActionMove    = "move"
)

// ClashActions lists the name_clash actions in display order, for
// [wire.Event.Actions]. Callers must not modify it.
var ClashActions = []string{ActionKickOld, ActionKickNew, ActionMove}

const (
	kindNameClash = "name_clash"

	// liveDebounce is the shortest gap between two teacher "live" events.
	liveDebounce = 250 * time.Millisecond
)

// Engine methods take no context: every query runs under this one.
var ctx = context.Background()

// Engine runs at most one sitting at a time. It is safe for concurrent use.
type Engine struct {
	st  *store.Store
	hub *events.Hub
	now func() time.Time

	mu          sync.Mutex
	lang        string
	snapshotDir string
	cur         *active // nil when no sitting is running
	ended       *active // the last ended sitting while none runs
	livePending bool
}

// active is the running sitting.
type active struct {
	sitting      db.Sitting
	assignment   db.Assignment
	test         testfmt.Test    // the snapshot taken at start
	media        map[string]bool // the names in test, see [testfmt.Test.Media]
	participants []*participant
	status       map[string]string   // device token → its last status; absent means unjoined
	movedFrom    map[string][]string // device token → ids of the participants moved off it
	clashes      map[string]clash    // unresolved name_clash event id → who it involves
}

type participant struct {
	id         string
	key        string // name lock: student id, or typedKey of the typed name and class
	name       string // display name
	class      string // typed class; empty for a class-list student
	device     string
	state      string
	finishedBy string // finishedByStudent or finishedByEnd once finished
	joinedAt   int64
	finishedAt int64                     // 0 until finished
	switches   int                       // window switches
	moves      int64                     // times moved to another device
	extraMs    int64                     // extra time the teacher gave, see deadline
	questions  []testfmt.Question        // the participant's own, see questionsFor
	answers    map[string]testfmt.Answer // question id → the student's answer
	late       map[string]bool           // question ids whose answer arrived late, see Engine.Submit
	overrides  map[string]float64        // question id → points set by the teacher

	// Presence lives only in memory: a restart counts everyone as just seen.
	lastSeen time.Time
	offline  bool
	synced   int // changes stored while offline
}

// clash identifies the holder participant and the newcomer device of a
// name_clash event.
type clash struct{ participantID, device string }

// New returns an engine that stores to st, publishes to hub and reads the time
// from now. It resumes the latest sitting, running or ended, and returns an
// error if that sitting cannot be read.
func New(st *store.Store, hub *events.Hub, now func() time.Time) (*Engine, error) {
	e := &Engine{st: st, hub: hub, now: now, lang: "uk"}
	if err := e.load(); err != nil {
		return nil, fmt.Errorf("sitting: resume running sitting: %w", err)
	}
	return e, nil
}

func (e *Engine) load() error {
	q := e.st.Q()
	s, err := q.GetLatestSitting(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	a, err := e.loadSitting(q, s)
	if err != nil {
		return err
	}
	if s.EndedAt.Valid {
		e.ended = a
	} else {
		e.cur = a
	}
	return nil
}

// Restore runs replace, which swaps the database's contents, then resumes the
// latest sitting of the new contents as [New] does. It returns
// [ErrSittingActive], without calling replace, while a sitting runs. If the new
// contents' latest sitting cannot be read, it returns that error and shows no
// sitting.
func (e *Engine) Restore(replace func() error) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur != nil {
		return ErrSittingActive
	}
	if err := replace(); err != nil {
		return err
	}
	e.ended = nil
	return e.load()
}

// loadSitting reads the sitting s, running or ended, with its participants,
// answers, overrides, moved devices and pending name clashes.
func (e *Engine) loadSitting(q *db.Queries, s db.Sitting) (*active, error) {
	// The snapshot was validated by testfmt.Decode at start.
	asg, t, err := assignmentTest(q, s.AssignmentID)
	if err != nil {
		return nil, err
	}
	a := newActive(s, asg, t)

	rows, err := q.ListParticipants(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	now := e.now()
	for _, r := range rows {
		key := r.StudentID.String
		if !r.StudentID.Valid {
			key = typedKey(r.TypedName.String, r.TypedClass.String)
		}
		a.participants = append(a.participants, &participant{
			id: r.ID, key: key, name: r.DisplayName, class: r.TypedClass.String, device: r.DeviceToken, state: r.State,
			finishedBy: r.FinishedBy.String, joinedAt: r.JoinedAt, finishedAt: r.FinishedAt.Int64, switches: int(r.WindowSwitches), moves: r.Moves, extraMs: r.ExtraMs, questions: questionsFor(t, r.ID),
			answers: map[string]testfmt.Answer{}, late: map[string]bool{}, overrides: map[string]float64{}, lastSeen: now,
		})
	}
	answers, err := q.ListAnswers(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	for _, ans := range answers {
		var value testfmt.Answer
		if err := json.Unmarshal([]byte(ans.Value), &value); err != nil {
			return nil, err
		}
		p := a.byID(ans.ParticipantID)
		p.answers[ans.QuestionID] = value
		p.late[ans.QuestionID] = ans.Late == 1
	}
	overrides, err := q.ListOverrides(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	for _, o := range overrides {
		a.byID(o.ParticipantID).overrides[o.QuestionID] = o.Points
	}
	moved, err := q.ListMovedDevices(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	movedOff := map[string][]string{} // participant id → device tokens
	for _, m := range moved {
		a.movedFrom[m.DeviceToken] = append(a.movedFrom[m.DeviceToken], m.ParticipantID)
		movedOff[m.ParticipantID] = append(movedOff[m.ParticipantID], m.DeviceToken)
	}
	// Replay participants in join order: each left "moved" on the devices it
	// was moved off and, if kicked, "kicked" on its own; a device a participant
	// still writes on is "writing". kick_new is not stored, so a device turned
	// away that way resumes as unjoined, which also shows it the name picker.
	for _, p := range a.participants {
		for _, token := range movedOff[p.id] {
			a.status[token] = statusMoved
		}
		if p.state == stateKicked {
			a.status[p.device] = statusKicked
		}
	}
	for _, p := range a.participants {
		if p.state != stateKicked {
			a.status[p.device] = statusWriting
		}
	}
	clashes, err := q.ListOpenClashes(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	for _, ev := range clashes {
		var p map[string]string
		if err := json.Unmarshal([]byte(ev.Params), &p); err != nil {
			return nil, err
		}
		a.clashes[ev.ID] = clash{p["participantId"], p["device"]}
	}
	return a, nil
}

func newActive(s db.Sitting, asg db.Assignment, t testfmt.Test) *active {
	media := map[string]bool{}
	for _, name := range t.Media() {
		media[name] = true
	}
	return &active{sitting: s, assignment: asg, test: t, media: media, status: map[string]string{}, movedFrom: map[string][]string{}, clashes: map[string]clash{}}
}

// DeviceStatus returns the device's status in the running sitting: "writing"
// while it writes as a participant, "kicked" or "moved" after the teacher sent
// it away, and "unjoined" before it picks a name or when no sitting runs.
func (e *Engine) DeviceStatus(token string) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil || e.cur.status[token] == "" {
		return statusUnjoined
	}
	return e.cur.status[token]
}

// Active reports whether a sitting is running, including one resumed at
// start-up. An ended sitting is not active.
func (e *Engine) Active() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.cur != nil
}

// HasMedia reports whether the media file name is used by the test of the
// running sitting or, while none runs, of the last ended one.
func (e *Engine) HasMedia(name string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	a := cmp.Or(e.cur, e.ended)
	return a != nil && a.media[name]
}

// SetLanguage sets the language student pages use ("uk" or "en"), sent in
// [wire.JoinInfo]. The default is "uk".
func (e *Engine) SetLanguage(lang string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lang = lang
}

// Start begins a sitting of the stored test, for the class with classID or,
// when classID is nil, for students who type their names. The test as it is
// now is snapshotted into a new assignment, so later edits don't reach the
// sitting. endsAt is the common end time, in unix ms, of a test whose time
// limit is "common"; other tests ignore it.
//
// It returns [ErrSittingActive] while another sitting runs, [ErrNotFound] for
// an unknown test or class, [ErrHasProblems] if the test has blocking
// problems, and [ErrInvalid] for a "common" test whose endsAt is not after
// now or is more than 12 hours ahead.
func (e *Engine) Start(testID string, classID *string, endsAt int64) (wire.SittingInfo, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur != nil {
		return wire.SittingInfo{}, ErrSittingActive
	}
	q := e.st.Q()
	row, err := q.GetTest(ctx, testID)
	if err != nil {
		return wire.SittingInfo{}, notFound(err)
	}
	t, err := testfmt.Decode([]byte(row.Doc))
	if err != nil {
		return wire.SittingInfo{}, err
	}
	if t.HasBlocking() {
		return wire.SittingInfo{}, ErrHasProblems
	}
	now := e.now().UnixMilli()
	var ends sql.NullInt64
	if t.Settings.TimeLimit.Mode == testfmt.TimeCommon {
		if endsAt <= now || endsAt > now+maxCommonEnd.Milliseconds() {
			return wire.SittingInfo{}, ErrInvalid
		}
		ends = sql.NullInt64{Int64: endsAt, Valid: true}
	}
	snapshot, err := json.Marshal(t)
	if err != nil {
		return wire.SittingInfo{}, err
	}
	asg := db.Assignment{ID: store.NewID(), TestID: valid(testID), TestSnapshot: string(snapshot), CreatedAt: now}
	if classID != nil {
		c, err := q.GetClass(ctx, *classID)
		if err != nil {
			return wire.SittingInfo{}, notFound(err)
		}
		asg.ClassID, asg.ClassName = valid(c.ID), valid(c.Name)
	}
	code, err := joinCode(q)
	if err != nil {
		return wire.SittingInfo{}, err
	}
	s := db.Sitting{ID: store.NewID(), AssignmentID: asg.ID, JoinCode: code, StartedAt: now, EndsAt: ends}

	err = e.commit(func(q *db.Queries) (func(), error) {
		err := q.InsertAssignment(ctx, db.InsertAssignmentParams{
			ID: asg.ID, TestID: asg.TestID, TestSnapshot: asg.TestSnapshot,
			ClassID: asg.ClassID, ClassName: asg.ClassName, CreatedAt: asg.CreatedAt,
		})
		if err != nil {
			return nil, err
		}
		err = q.InsertSitting(ctx, db.InsertSittingParams{ID: s.ID, AssignmentID: s.AssignmentID, JoinCode: s.JoinCode, StartedAt: s.StartedAt, EndsAt: s.EndsAt})
		return func() { e.cur, e.ended = newActive(s, asg, t), nil }, err
	})
	if err != nil {
		return wire.SittingInfo{}, err
	}
	return e.cur.info(), nil
}

func (a *active) info() wire.SittingInfo {
	return wire.SittingInfo{
		SittingID:     a.sitting.ID,
		AssignmentID:  a.assignment.ID,
		Code:          a.sitting.JoinCode,
		TestTitle:     a.test.Title,
		ClassName:     a.assignment.ClassName.String,
		QuestionCount: len(a.test.Questions),
		StartedAt:     a.sitting.StartedAt,
		Ended:         a.sitting.EndedAt.Valid,
		Scale:         a.test.Settings.Scale.Kind,
		TimeMode:      a.test.Settings.TimeLimit.Mode,
		Minutes:       a.test.Settings.TimeLimit.Minutes,
		EndsAt:        a.sitting.EndsAt.Int64,
	}
}

// joinCode returns a random 4-digit code that differs from the codes of the
// last 20 sittings, so a device still holding an old code can't land in the
// new sitting.
func joinCode(q *db.Queries) (string, error) {
	recent, err := q.RecentJoinCodes(ctx)
	if err != nil {
		return "", err
	}
	for {
		n, err := rand.Int(rand.Reader, big.NewInt(10000))
		if err != nil {
			return "", err
		}
		if code := fmt.Sprintf("%04d", n.Int64()); !slices.Contains(recent, code) {
			return code, nil
		}
	}
}

// commit runs write in a transaction and, once it commits, applies the
// in-memory change write returned and schedules a teacher "live" event. The
// caller holds e.mu.
func (e *Engine) commit(write func(q *db.Queries) (apply func(), err error)) error {
	var apply func()
	err := e.st.Tx(ctx, func(q *db.Queries) error {
		var err error
		apply, err = write(q)
		return err
	})
	if err != nil {
		return err
	}
	apply()
	e.changed()
	return nil
}

// changed publishes a teacher "live" event liveDebounce after the first of a
// burst of changes, so the teacher page refetches once per burst. The caller
// holds e.mu.
func (e *Engine) changed() {
	if e.livePending {
		return
	}
	e.livePending = true
	time.AfterFunc(liveDebounce, func() {
		e.mu.Lock()
		e.livePending = false
		e.mu.Unlock()
		e.hub.Publish(events.Event{Topic: "teacher", Name: "live"})
	})
}

// publishStatus tells the device that its status changed.
func (e *Engine) publishStatus(device string) {
	e.hub.Publish(events.Event{Topic: "device:" + device, Name: "status"})
}

// publishTaken tells the devices choosing a name which class-list students
// are held in the sitting a, as the "taken" event on topic
// names:<sittingID> (see [wire.NamesTaken]). A sitting without a class list
// publishes nothing. The caller holds e.mu.
func (e *Engine) publishTaken(a *active) {
	if !a.assignment.ClassID.Valid {
		return
	}
	taken := []string{}
	for _, p := range a.participants {
		if p.state != stateKicked {
			taken = append(taken, p.key)
		}
	}
	e.hub.Publish(events.Event{Topic: "names:" + a.sitting.ID, Name: "taken", Data: wire.NamesTaken{Taken: taken}})
}

// SittingID returns the id of the running sitting, or "" when none runs.
func (e *Engine) SittingID() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil {
		return ""
	}
	return e.cur.sitting.ID
}

// raise stores an event of the sitting and returns its id.
func (e *Engine) raise(q *db.Queries, sittingID, kind string, params map[string]string, pinned bool) (string, error) {
	b, err := json.Marshal(params)
	if err != nil {
		return "", err
	}
	ev := db.InsertEventParams{ID: store.NewID(), SittingID: sittingID, Kind: kind, Params: string(b), CreatedAt: e.now().UnixMilli()}
	if pinned {
		ev.Pinned = 1
	}
	return ev.ID, q.InsertEvent(ctx, ev)
}

func (a *active) byID(id string) *participant {
	for _, p := range a.participants {
		if p.id == id {
			return p
		}
	}
	return nil
}

// holder returns the participant holding the name lock key, or nil.
func (a *active) holder(key string) *participant {
	for _, p := range a.participants {
		if p.key == key && p.state != stateKicked {
			return p
		}
	}
	return nil
}

// clashesOf returns the ids of the pending name_clash events over the name the
// participant holds.
func (a *active) clashesOf(participantID string) []string {
	var ids []string
	for id, c := range a.clashes {
		if c.participantID == participantID {
			ids = append(ids, id)
		}
	}
	return ids
}

// onDevice returns the participant the device is writing as, or nil.
func (a *active) onDevice(device string) *participant {
	for _, p := range a.participants {
		if p.device == device && p.state != stateKicked {
			return p
		}
	}
	return nil
}

func valid(s string) sql.NullString { return sql.NullString{String: s, Valid: true} }

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
