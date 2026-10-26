package sitting

import (
	"cmp"
	"encoding/json"
	"math"
	"slices"
	"strconv"

	"klats/internal/grading"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

// Results grades every participant of every sitting of the assignment against
// their own questions of its test snapshot (see questionsFor), with the
// teacher's overrides, leaving kicked participants out. It returns
// [ErrNotFound] for an unknown assignment.
func (e *Engine) Results(assignmentID string) (wire.AssignmentResults, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	q := e.st.Q()
	asg, t, err := assignmentTest(q, assignmentID)
	if err != nil {
		return wire.AssignmentResults{}, err
	}
	sittings, err := q.ListAssignmentSittings(ctx, assignmentID)
	if err != nil {
		return wire.AssignmentResults{}, err
	}
	out := wire.AssignmentResults{
		Scale: t.Settings.Scale.Kind, AssignmentID: asg.ID, TestTitle: t.Title, ClassName: asg.ClassName.String,
		Exported: asg.ExportedAt.Valid, ExportStale: asg.ExportStale == 1, ResultsRev: asg.ResultsRev,
		Questions: []wire.ResultQuestion{}, Rows: []wire.ResultRow{},
	}
	full, rated := make([]int, len(t.Questions)), make([]int, len(t.Questions))
	for _, s := range sittings {
		a, err := e.loadSitting(q, s)
		if err != nil {
			return wire.AssignmentResults{}, err
		}
		for _, p := range a.participants {
			if p.state == stateKicked {
				continue
			}
			r := a.grade(p)
			row := wire.ResultRow{
				ParticipantID: p.id, Name: p.name, ClassName: cmp.Or(p.class, asg.ClassName.String),
				Points: make([]float64, len(t.Questions)), Earned: r.Earned, Max: r.Max, Grade: r.Grade, PendingIDs: []string{},
				SittingDate: s.StartedAt, Answers: map[string]testfmt.Answer{}, Verdicts: r.Verdicts, Overridden: []string{}, Late: []string{},
				NotAsked: []string{}, Writing: p.state == stateWriting,
			}
			if p.finishedAt > 0 {
				row.DurationSec = int(max(0, p.finishedAt-p.joinedAt) / 1000)
			}
			asked := make(map[string]bool, len(p.questions))
			for _, question := range p.questions {
				asked[question.ID] = true
			}
			for i, question := range t.Questions {
				if !asked[question.ID] {
					row.NotAsked = append(row.NotAsked, question.ID)
					continue
				}
				row.Points[i] = r.PerQuestion[question.ID]
				if fullPoints(question, row.Points[i]) {
					full[i]++
				}
				ans := p.answers[question.ID]
				if !ans.IsEmpty() {
					row.Answers[question.ID] = ans
				}
				_, overridden := p.overrides[question.ID]
				if overridden {
					row.Overridden = append(row.Overridden, question.ID)
				}
				if grading.IsPending(question, ans, overridden) {
					row.PendingIDs = append(row.PendingIDs, question.ID)
				} else {
					rated[i]++
				}
				if p.late[question.ID] {
					row.Late = append(row.Late, question.ID)
				}
			}
			out.Rows = append(out.Rows, row)
		}
	}
	for i, question := range t.Questions {
		rq := wire.ResultQuestion{Question: question, Correct: full[i]}
		if question.Type == "highlight" {
			doc, words := question.Words()
			rq.Words, _ = json.Marshal(doc) // a rich.Doc holds nothing that fails to marshal
			for j, w := range words {
				if w.Target {
					rq.TargetWords = append(rq.TargetWords, strconv.Itoa(j))
				}
			}
		}
		if rated[i] > 0 {
			pct := int(math.Round(100 * float64(full[i]) / float64(rated[i])))
			rq.CorrectPct = &pct
		}
		out.Questions = append(out.Questions, rq)
	}
	byName(out.Rows, func(r wire.ResultRow) string { return r.Name })
	return out, nil
}

// SetOverride sets the points the participant gets for the question in place
// of the automatic score, or clears the override when points is nil, and
// marks the assignment's export stale. It returns [ErrNotFound] for an unknown
// assignment, question or participant of the assignment, and [ErrInvalid] for
// points outside 0 to the question's points.
func (e *Engine) SetOverride(assignmentID, participantID, questionID string, points *float64) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	q := e.st.Q()
	_, t, err := assignmentTest(q, assignmentID)
	if err != nil {
		return err
	}
	i := slices.IndexFunc(t.Questions, func(question testfmt.Question) bool { return question.ID == questionID })
	if i < 0 {
		return ErrNotFound
	}
	row, err := q.GetParticipant(ctx, participantID)
	if err != nil {
		return notFound(err)
	}
	s, err := q.GetSitting(ctx, row.SittingID)
	if err != nil {
		return err
	}
	if s.AssignmentID != assignmentID {
		return ErrNotFound
	}
	if points != nil && !(*points >= 0 && *points <= float64(t.Questions[i].Points)) {
		return ErrInvalid
	}
	return e.commit(func(q *db.Queries) (func(), error) {
		var err error
		if points == nil {
			err = q.DeleteOverride(ctx, db.DeleteOverrideParams{AssignmentID: assignmentID, ParticipantID: participantID, QuestionID: questionID})
		} else {
			err = q.UpsertOverride(ctx, db.UpsertOverrideParams{AssignmentID: assignmentID, ParticipantID: participantID, QuestionID: questionID, Points: *points})
		}
		if err != nil {
			return nil, err
		}
		return func() {
			if _, p := e.held(participantID); p != nil {
				if points == nil {
					delete(p.overrides, questionID)
				} else {
					p.overrides[questionID] = *points
				}
			}
			e.publishStatus(row.DeviceToken)
		}, q.SetExportStale(ctx, assignmentID)
	})
}

// assignmentTest returns the assignment and its test snapshot, or
// [ErrNotFound].
func assignmentTest(q *db.Queries, id string) (db.Assignment, testfmt.Test, error) {
	asg, err := q.GetAssignment(ctx, id)
	if err != nil {
		return db.Assignment{}, testfmt.Test{}, notFound(err)
	}
	var t testfmt.Test
	err = json.Unmarshal([]byte(asg.TestSnapshot), &t)
	return asg, t, err
}
