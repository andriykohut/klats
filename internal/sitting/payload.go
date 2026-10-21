package sitting

import (
	"encoding/json"
	"hash/fnv"
	"io"
	"math/rand/v2"

	"klats/internal/testfmt"
	"klats/internal/wire"
)

// Resume returns what the device needs to start or resume writing: the test
// (without correct answers or points; questions keep their order, and the
// options of a question with ShuffleOptions are shuffled in an order fixed per
// device), the answers stored for the device's participant, that
// participant's id and the device's status. It returns
// [ErrKicked] if the teacher sent the device back to the name picker and
// [ErrNotJoined] unless the device writes as a participant in the running
// sitting.
func (e *Engine) Resume(device string) (wire.TestResponse, error) {
	e.mu.Lock()
	if e.cur == nil {
		e.mu.Unlock()
		return wire.TestResponse{}, ErrNotJoined
	}
	if e.cur.status[device] == statusKicked {
		e.mu.Unlock()
		return wire.TestResponse{}, ErrKicked
	}
	p := e.cur.onDevice(device)
	if p == nil {
		e.mu.Unlock()
		return wire.TestResponse{}, ErrNotJoined
	}
	if err := e.touch(device); err != nil {
		e.mu.Unlock()
		return wire.TestResponse{}, err
	}
	res := wire.TestResponse{ParticipantID: p.id, Test: studentTest(e.cur.test, device), Status: e.status(device)}
	e.mu.Unlock()

	rows, err := e.st.Q().ListParticipantAnswers(ctx, res.ParticipantID)
	if err != nil {
		return wire.TestResponse{}, err
	}
	res.Answers = make([]wire.StoredAnswer, 0, len(rows))
	for _, r := range rows {
		var options []string
		if err := json.Unmarshal([]byte(r.OptionIds), &options); err != nil {
			return wire.TestResponse{}, err
		}
		res.Answers = append(res.Answers, wire.StoredAnswer{QuestionID: r.QuestionID, OptionIDs: options, Seq: r.Seq})
	}
	return res, nil
}

func studentTest(t testfmt.Test, device string) wire.StudentTest {
	out := wire.StudentTest{Title: t.Title, Palette: t.Palette, Questions: make([]wire.StudentQuestion, len(t.Questions))}
	for i, q := range t.Questions {
		opts := make([]wire.StudentOption, len(q.Options))
		for j, o := range q.Options {
			opts[j] = wire.StudentOption{ID: o.ID, Content: o.Content}
		}
		if q.ShuffleOptions {
			h := fnv.New64a()
			_, _ = io.WriteString(h, device+q.ID)
			seed := h.Sum64()
			rand.New(rand.NewPCG(seed, seed)).Shuffle(len(opts), func(i, j int) { opts[i], opts[j] = opts[j], opts[i] })
		}
		out.Questions[i] = wire.StudentQuestion{ID: q.ID, Type: q.Type, Text: q.Text, Options: opts}
	}
	return out
}
