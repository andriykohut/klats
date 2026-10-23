// Package wire holds the JSON shapes of the student and teacher APIs. It is
// the source tygo turns into the TypeScript types both web apps use, so every
// field carries a camelCase tag. Times are unix milliseconds.
package wire

import "encoding/json"

// SittingInfo describes a sitting to the teacher. ClassName is empty when the
// sitting has no class list. Ended is set once the teacher ended it.
type SittingInfo struct {
	SittingID     string `json:"sittingId"`
	AssignmentID  string `json:"assignmentId"`
	Code          string `json:"code"`
	TestTitle     string `json:"testTitle"`
	ClassName     string `json:"className"`
	QuestionCount int    `json:"questionCount"`
	StartedAt     int64  `json:"startedAt"`
	Ended         bool   `json:"ended"`
}

// JoinInfo is what a student device gets for a correct join code. Mode is
// "list" (pick a name from Names) or "typed" (type surname, first name and
// class; Names is empty).
type JoinInfo struct {
	SittingID string      `json:"sittingId"`
	Mode      string      `json:"mode"`
	Names     []NameEntry `json:"names"`
	Language  string      `json:"language"`
}

// NamesTaken is the "taken" event a device choosing a name gets on its event
// stream: the ids of the class-list students devices hold in the running
// sitting.
type NamesTaken struct {
	Taken []string `json:"taken"`
}

// NameEntry is one class-list name. Taken means another device holds it.
type NameEntry struct {
	StudentID string `json:"studentId"`
	Name      string `json:"name"`
	Taken     bool   `json:"taken"`
}

// PickRequest names the student a device is joining as: StudentID in list
// mode, Surname, FirstName and ClassName in typed mode.
type PickRequest struct {
	StudentID string `json:"studentId"`
	Surname   string `json:"surname"`
	FirstName string `json:"firstName"`
	ClassName string `json:"className"`
}

// JoinRequest is the body of a student device's join: the sitting's join code.
type JoinRequest struct {
	Code string `json:"code"`
}

// PickBody is the body of a student device's name pick: the join code and the
// student to join as.
type PickBody struct {
	PickRequest `tstype:",extends"`
	Code        string `json:"code"`
}

// FocusRequest is the body of a student device's focus report. Left is true
// when the page lost focus.
type FocusRequest struct {
	Left bool `json:"left"`
}

// Participant is one student's place in a sitting. State is "writing",
// "finished" or "kicked".
type Participant struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DeviceLabel string `json:"deviceLabel"`
	State       string `json:"state"`
}

// StudentTest is the test as a student device receives it: no correct
// answers, points or scoring rules.
type StudentTest struct {
	Title     string            `json:"title"`
	Palette   string            `json:"palette"`
	Questions []StudentQuestion `json:"questions"`
}

// StoredAnswer is an answer the server holds for a participant. Seq is the
// highest sequence number stored for the question.
type StoredAnswer struct {
	QuestionID string   `json:"questionId"`
	OptionIDs  []string `json:"optionIds"`
	Seq        int64    `json:"seq"`
}

// TestResponse is what a student device loads to start or resume writing: the
// test, the answers already stored, its participant id (carried by every
// [AnswerChange]) and its current status. SeqBase is the seq every answer
// change from the device must exceed: it rises by a million each time the
// teacher moves the participant to another device, so the new device's
// changes outrank those its old device still holds.
type TestResponse struct {
	ParticipantID string         `json:"participantId"`
	Test          StudentTest    `json:"test"`
	Answers       []StoredAnswer `json:"answers"`
	SeqBase       int64          `json:"seqBase"`
	Status        Status         `json:"status"`
}

type StudentQuestion struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Text    json.RawMessage `json:"text"`
	Options []StudentOption `json:"options"`
}

type StudentOption struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
}

// Event is an entry in the teacher's events panel. The teacher UI renders its
// text from Kind and Params. A pinned event waits for one of Actions.
type Event struct {
	ID      string            `json:"id"`
	Kind    string            `json:"kind"`
	Params  map[string]string `json:"params"`
	At      int64             `json:"at"`
	Pinned  bool              `json:"pinned"`
	Actions []string          `json:"actions"`
}

// SubmitRequest is the body of a student device's answer batch. Pending is
// how many unacked changes the device still holds after this batch.
type SubmitRequest struct {
	Changes []AnswerChange `json:"changes"`
	Pending int            `json:"pending"`
}

// HeartbeatRequest is the body of a student device's heartbeat. Pending is
// how many unacked changes the device holds.
type HeartbeatRequest struct {
	Pending int `json:"pending"`
}

// AnswerChange is one answer edit from a student device, for the participant
// the device picked. Seq numbers the edits of one question from 1 and the
// highest Seq wins. It carries no client time: ordering and late flags use
// only Seq and the server clock.
type AnswerChange struct {
	ChangeID      string   `json:"changeId"`
	ParticipantID string   `json:"participantId"`
	QuestionID    string   `json:"questionId"`
	OptionIDs     []string `json:"optionIds"`
	Seq           int64    `json:"seq"`
}

// SubmitResult answers a batch of changes. Acks lists every change id the
// device can forget, including repeats and changes that were not stored.
// Rejected counts the acked changes refused as malformed or not the device's
// to send.
type SubmitResult struct {
	Acks     []string `json:"acks"`
	Rejected int      `json:"rejected"`
	Status   Status   `json:"status"`
}

// Status is what a student device is told about its place in the sitting.
// State is "writing", "finished" (by the student, while the sitting runs),
// "ended" (the teacher ended the sitting), "kicked", "moved" or "unjoined".
// Result is set once the participant has finished; for one finished by the
// end of the sitting, only once the device reports no pending changes, which
// also stops it taking more. RemainingMs is always nil in this version, which
// has no time limits.
type Status struct {
	State       string        `json:"state"`
	RemainingMs *int64        `json:"remainingMs"`
	Result      *FinishResult `json:"result"`
}

// FinishResult is the grade a student sees: no correct answers, only how many
// of Total questions scored full points.
type FinishResult struct {
	Grade   int `json:"grade"`
	Correct int `json:"correct"`
	Total   int `json:"total"`
}

// LiveSnapshot is the teacher's live view of the running sitting or, until
// the next one starts, of the last ended one. Kicked participants are left
// out. QuestionPct has one entry per question: the percent of answers to it
// that score full points, or nil while nobody has answered it. Events lists
// the pinned events waiting for a decision, then the 20 newest others, newest
// first.
type LiveSnapshot struct {
	Sitting     SittingInfo `json:"sitting"`
	Counts      Counts      `json:"counts"`
	Rows        []LiveRow   `json:"rows"`
	QuestionPct []*int      `json:"questionPct"`
	Events      []Event     `json:"events"`
}

// Counts sums up the live view. ClassSize is 0 for a sitting without a class
// list; NotJoined names the class-list students who have not joined.
type Counts struct {
	InTest    int      `json:"inTest"`
	ClassSize int      `json:"classSize"`
	Finished  int      `json:"finished"`
	Offline   int      `json:"offline"`
	NotJoined []string `json:"notJoined"`
}

// LiveRow is one participant in the live view, in Ukrainian order of Name.
// Cells has one entry per question: "correct" (full points), "wrong"
// (answered with fewer), "current" (the question after the last one answered,
// while writing) or "empty". Status is "writing", "offline" or "finished".
// Grade is set once finished.
type LiveRow struct {
	ParticipantID  string   `json:"participantId"`
	Name           string   `json:"name"`
	DeviceToken    string   `json:"deviceToken"`
	DeviceLabel    string   `json:"deviceLabel"`
	Cells          []string `json:"cells"`
	Status         string   `json:"status"`
	Grade          *int     `json:"grade"`
	WindowSwitches int      `json:"windowSwitches"`
}

// AssignmentResults are the graded results of every sitting of an
// assignment, kicked participants left out. Exported is set once an Excel
// export was written. ExportStale means results changed after the last
// export, or, before the first one, since the assignment started; only both
// together mean an exported file is out of date.
type AssignmentResults struct {
	AssignmentID string           `json:"assignmentId"`
	TestTitle    string           `json:"testTitle"`
	ClassName    string           `json:"className"`
	Exported     bool             `json:"exported"`
	ExportStale  bool             `json:"exportStale"`
	ResultsRev   int64            `json:"resultsRev"`
	Questions    []ResultQuestion `json:"questions"`
	Rows         []ResultRow      `json:"rows"`
}

// ResultQuestion is a question of the results table, as the assignment's test
// snapshot has it, correct options included: the teacher may have edited the
// test since. Correct is the number of rows that scored full points on it, and
// CorrectPct is that count as a percent of all rows.
type ResultQuestion struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Text       json.RawMessage `json:"text"`
	Points     int             `json:"points"`
	Options    []ResultOption  `json:"options"`
	Correct    int             `json:"correct"`
	CorrectPct int             `json:"correctPct"`
}

// ResultOption is an option of a [ResultQuestion]. It goes to the teacher
// only: student devices never get Correct.
type ResultOption struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
	Correct bool            `json:"correct"`
}

// ResultRow is one participant's result, in Ukrainian order of Name. Points
// has one entry per question, teacher overrides applied; Overridden lists the
// ids of the overridden questions. Writing is set while the participant is
// still writing in the running sitting, and DurationSec is 0 until they
// finish. SittingDate is when the participant's sitting started.
// Answers maps question id to the selected option ids, for answered questions;
// Late lists the questions whose answer arrived after the sitting ended.
type ResultRow struct {
	ParticipantID string              `json:"participantId"`
	Name          string              `json:"name"`
	ClassName     string              `json:"className"`
	Points        []float64           `json:"points"`
	Earned        float64             `json:"earned"`
	Max           float64             `json:"max"`
	Grade         int                 `json:"grade"`
	Writing       bool                `json:"writing"`
	DurationSec   int                 `json:"durationSec"`
	SittingDate   int64               `json:"sittingDate"`
	Answers       map[string][]string `json:"answers"`
	Overridden    []string            `json:"overridden"`
	Late          []string            `json:"late"`
}
