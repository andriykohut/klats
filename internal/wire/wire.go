// Package wire holds the JSON shapes of the student and teacher APIs. It is
// the source tygo turns into the TypeScript types both web apps use, so every
// field carries a camelCase tag. Times are unix milliseconds.
package wire

import (
	"encoding/json"

	"klats/internal/testfmt"
)

// SittingInfo describes a sitting to the teacher. ClassName is empty when the
// sitting has no class list. Ended is set once the teacher ended it. Scale is
// the kind of the test's grading scale (testfmt.Scale.Kind) that the grades in
// the live view are on. TimeMode and Minutes are the test's time limit
// (testfmt.TimeLimit); EndsAt is the common end time of a "common" one, else 0.
type SittingInfo struct {
	SittingID     string `json:"sittingId"`
	AssignmentID  string `json:"assignmentId"`
	Code          string `json:"code"`
	TestTitle     string `json:"testTitle"`
	ClassName     string `json:"className"`
	QuestionCount int    `json:"questionCount"`
	StartedAt     int64  `json:"startedAt"`
	Ended         bool   `json:"ended"`
	Scale         string `json:"scale"`
	TimeMode      string `json:"timeMode"`
	Minutes       int    `json:"minutes"`
	EndsAt        int64  `json:"endsAt"`
}

// JoinInfo is what a student device gets for a correct join code. Mode is
// "list" (pick a name from Names) or "typed" (type surname, first name and
// class; Names is empty). TimeMode, Minutes and EndsAt are the time limit, as
// in [SittingInfo].
type JoinInfo struct {
	SittingID string      `json:"sittingId"`
	Mode      string      `json:"mode"`
	Names     []NameEntry `json:"names"`
	Language  string      `json:"language"`
	TimeMode  string      `json:"timeMode"`
	Minutes   int         `json:"minutes"`
	EndsAt    int64       `json:"endsAt"`
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
	QuestionID string         `json:"questionId"`
	Answer     testfmt.Answer `json:"answer"`
	Seq        int64          `json:"seq"`
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

// StudentQuestion is a question as a student sees it: what is shown and what
// can be picked, never what is right.
type StudentQuestion struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Text    json.RawMessage `json:"text"`
	Options []StudentOption `json:"options"`
	Targets []StudentTarget `json:"targets,omitempty"`
	Body    json.RawMessage `json:"body,omitempty"`
	Gaps    []StudentGap    `json:"gaps,omitempty"`
	Image   *testfmt.Image  `json:"image,omitempty"`
}

type StudentOption struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
	Image   *testfmt.Image  `json:"image,omitempty"`
}

// StudentTarget is a target of a [StudentQuestion]. X and Y place a point on
// the question's image.
type StudentTarget struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
	Image   *testfmt.Image  `json:"image,omitempty"`
	X       float64         `json:"x"`
	Y       float64         `json:"y"`
}

// StudentGap is a gap of a [StudentQuestion]'s body. A gap typed into has no
// choices.
type StudentGap struct {
	ID      string          `json:"id"`
	Choices []StudentChoice `json:"choices,omitempty"`
}

// StudentChoice is an entry of a list gap, without whether it is right.
type StudentChoice struct {
	ID   string `json:"id"`
	Text string `json:"text"`
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
	ChangeID      string         `json:"changeId"`
	ParticipantID string         `json:"participantId"`
	QuestionID    string         `json:"questionId"`
	Answer        testfmt.Answer `json:"answer"`
	Seq           int64          `json:"seq"`
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
// also stops it taking more. RemainingMs is set only while the participant
// writes in the running sitting of a test with a time limit: the time left
// until its deadline by the server's clock, extra time included, and 0 once
// the deadline has passed.
type Status struct {
	State       string        `json:"state"`
	RemainingMs *int64        `json:"remainingMs"`
	Result      *FinishResult `json:"result"`
}

// FinishResult is the grade a student sees: no correct answers, only how many
// of the Total questions the participant got scored full points. Grade is on
// the scale kind Scale (testfmt.Scale.Kind) of the test: 1-12, a percent, or 1
// for a pass and 0 for a fail. Pending is set while a written answer waits for
// the teacher's points; Grade and Correct count it as 0 until then.
type FinishResult struct {
	Scale   string `json:"scale"`
	Grade   int    `json:"grade"`
	Correct int    `json:"correct"`
	Total   int    `json:"total"`
	Pending bool   `json:"pending"`
}

// LiveSnapshot is the teacher's live view of the running sitting or, until
// the next one starts, of the last ended one. Kicked participants are left
// out. QuestionPct has one entry per question: the percent of answers to it
// that score full points, or nil while there are none; written answers waiting
// for the teacher are left out. Events lists the pinned events waiting for a
// decision, then the 20 newest others, newest first.
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
// Cells has one entry per question of the test, in test order: "correct"
// (full points), "wrong" (answered with fewer), "pending" (a written answer
// the teacher has not graded), "current" (while writing, the question after
// the last one answered in the participant's own order), "empty", or
// "absent" (a question the participant did not get, see
// [testfmt.Settings.Subset]). Status is "writing", "offline" or "finished".
// Grade is set once finished, on the scale of [SittingInfo.Scale]; Pending
// counts the "pending" cells, which Grade scores as 0.
type LiveRow struct {
	ParticipantID  string   `json:"participantId"`
	Name           string   `json:"name"`
	DeviceToken    string   `json:"deviceToken"`
	DeviceLabel    string   `json:"deviceLabel"`
	Cells          []string `json:"cells"`
	Status         string   `json:"status"`
	Grade          *int     `json:"grade"`
	Pending        int      `json:"pending"`
	WindowSwitches int      `json:"windowSwitches"`
}

// AssignmentResults are the graded results of every sitting of an
// assignment, kicked participants left out. Exported is set once an Excel
// export was written. ExportStale means results changed after the last
// export, or, before the first one, since the assignment started; only both
// together mean an exported file is out of date. Scale is the kind of the
// test's grading scale (testfmt.Scale.Kind) that every ResultRow.Grade is on.
type AssignmentResults struct {
	Scale        string           `json:"scale"`
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
// snapshot has it, answer key included: the teacher may have edited the test
// since. Correct is the number of rows that scored full points on it, and
// CorrectPct is that count as a percent of the rows that got the question
// (see ResultRow.NotAsked) and whose answer is not waiting for the teacher's
// points (see ResultRow.PendingIDs), or nil when there is no such row. A
// highlight question also carries Words, its body as students got it (see
// testfmt.Question.Words), and TargetWords, the indexes of its marked words.
type ResultQuestion struct {
	Question    testfmt.Question `json:"question"`
	Correct     int              `json:"correct"`
	CorrectPct  *int             `json:"correctPct"`
	Words       json.RawMessage  `json:"words,omitempty"`
	TargetWords []string         `json:"targetWords,omitempty"`
}

// ResultRow is one participant's result, in Ukrainian order of Name. Grade is
// on the scale of [AssignmentResults.Scale]. Points has one entry per
// question, teacher overrides applied; Overridden lists the ids of the
// overridden questions. Writing is set while the participant is
// still writing in the running sitting, and DurationSec is 0 until they
// finish. SittingDate is when the participant's sitting started.
// Answers maps question id to the answer, for answered questions; Verdicts
// maps question id to whether each part of the answer is right (see
// grading.Verdict), for the questions with an answered part; Late lists the
// questions whose answer arrived after the sitting ended, or more than 10 s
// after the participant's time ran out. PendingIDs lists, in
// test order, the questions whose written answer waits for the teacher's
// points (see grading.IsPending); they score 0 until then. NotAsked lists, in
// test order, the questions the participant did not get (see
// testfmt.Settings.Subset): their Points are 0, and Earned and Max leave them
// out.
type ResultRow struct {
	ParticipantID string                     `json:"participantId"`
	Name          string                     `json:"name"`
	ClassName     string                     `json:"className"`
	Points        []float64                  `json:"points"`
	Earned        float64                    `json:"earned"`
	Max           float64                    `json:"max"`
	Grade         int                        `json:"grade"`
	PendingIDs    []string                   `json:"pendingIds"`
	Writing       bool                       `json:"writing"`
	DurationSec   int                        `json:"durationSec"`
	SittingDate   int64                      `json:"sittingDate"`
	Answers       map[string]testfmt.Answer  `json:"answers"`
	Verdicts      map[string]map[string]bool `json:"verdicts"`
	Overridden    []string                   `json:"overridden"`
	Late          []string                   `json:"late"`
	NotAsked      []string                   `json:"notAsked"`
}
