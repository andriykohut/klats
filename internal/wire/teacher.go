package wire

import "klats/internal/testfmt"

// TestSummary is a row of the test library. Blocking is set when the test has
// problems that stop it being started.
type TestSummary struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	UpdatedAt     int64  `json:"updatedAt"`
	QuestionCount int    `json:"questionCount"`
	Blocking      bool   `json:"blocking"`
}

// NewTestRequest creates an empty test. An empty Title gets the default title.
type NewTestRequest struct {
	Title string `json:"title"`
}

// ProblemsError is the 409 body for a test that cannot be started: Error is
// "has_problems" and Problems lists what blocks it.
type ProblemsError struct {
	Error    string            `json:"error"`
	Problems []testfmt.Problem `json:"problems"`
}

// TestDoc is a stored test with its current problems. SavedAt is when it was
// last saved.
type TestDoc struct {
	ID       string            `json:"id"`
	Test     testfmt.Test      `json:"test"`
	Problems []testfmt.Problem `json:"problems"`
	SavedAt  int64             `json:"savedAt"`
}

// SaveResult answers a test save. Problems never block saving.
type SaveResult struct {
	Problems []testfmt.Problem `json:"problems"`
	SavedAt  int64             `json:"savedAt"`
}

// ClassSummary is a row of the class list.
type ClassSummary struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	StudentCount int    `json:"studentCount"`
}

// Class is a class list with its students in Ukrainian order of name. On
// create and save, ID is empty for a new student.
type Class struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Students []Student `json:"students"`
}

// Student is a member of a [Class].
type Student struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ParseRequest is pasted class-list text, such as cells copied from Excel.
type ParseRequest struct {
	Text string `json:"text"`
}

// ParseResult is the student names found in a [ParseRequest]. Duplicates are
// kept.
type ParseResult struct {
	Names []string `json:"names"`
}

// StartRequest starts a sitting of a test. Without ClassID, students type
// their names.
type StartRequest struct {
	TestID  string  `json:"testId"`
	ClassID *string `json:"classId"`
}

// MoveRequest names the device a participant moves to.
type MoveRequest struct {
	Device string `json:"device"`
}

// ResolveRequest is the teacher's decision on a pinned event.
type ResolveRequest struct {
	Action string `json:"action"`
}

// LabelRequest is a new device label, 1 to 20 characters.
type LabelRequest struct {
	Label string `json:"label"`
}

// AssignmentSummary is a row of the results list. Participants does not count
// kicked ones. AverageGrade is the mean grade of those participants, nil while
// there are none.
type AssignmentSummary struct {
	ID           string   `json:"id"`
	TestTitle    string   `json:"testTitle"`
	ClassName    string   `json:"className"`
	CreatedAt    int64    `json:"createdAt"`
	Participants int      `json:"participants"`
	ExportStale  bool     `json:"exportStale"`
	AverageGrade *float64 `json:"averageGrade"`
}

// OverrideRequest sets the points of a participant's answer, or clears the
// override when Points is nil.
type OverrideRequest struct {
	ParticipantID string   `json:"participantId"`
	QuestionID    string   `json:"questionId"`
	Points        *float64 `json:"points"`
}

// ExportResult is where the exported workbook was saved.
type ExportResult struct {
	Path string `json:"path"`
}

// NetworkInfo describes the address students use. Candidates are the
// addresses the teacher can choose from; Address is empty when there are none.
// Port is the student server's port. While the server is not running, URL is
// empty, Port is the saved port and Error says why: "port_busy" when the saved
// port could not be bound.
type NetworkInfo struct {
	Candidates []string `json:"candidates"`
	Address    string   `json:"address"`
	URL        string   `json:"url"`
	Port       int      `json:"port"`
	Error      string   `json:"error,omitempty"`
}

// NetworkRequest chooses the address students use.
type NetworkRequest struct {
	Address string `json:"address"`
}

// SettingsInfo holds the program settings. A changed Port applies at the next
// launch; RestartRequired is set while the saved Port differs from the port
// the student server runs on, and always while that server is not running. It
// is ignored in requests.
type SettingsInfo struct {
	Port            int    `json:"port"`
	Language        string `json:"language"`
	RestartRequired bool   `json:"restartRequired"`
}
