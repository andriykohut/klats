// Package wire holds the JSON shapes of the student and teacher APIs. It is
// the source tygo turns into the TypeScript types both web apps use, so every
// field carries a camelCase tag. Times are unix milliseconds.
package wire

import "encoding/json"

// SittingInfo describes the running sitting to the teacher. ClassName is
// empty when the sitting has no class list.
type SittingInfo struct {
	SittingID     string `json:"sittingId"`
	AssignmentID  string `json:"assignmentId"`
	Code          string `json:"code"`
	TestTitle     string `json:"testTitle"`
	ClassName     string `json:"className"`
	QuestionCount int    `json:"questionCount"`
	StartedAt     int64  `json:"startedAt"`
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
