package sitting

import (
	"encoding/json"
	"hash/fnv"
	"io"
	"math/rand/v2"

	"klats/internal/testfmt"
	"klats/internal/wire"
)

// moveSeqStride is how far the seq base rises with each move of a
// participant. A device numbers its answer changes above the base it got at
// its last resume, so the device a participant was moved to outranks every
// change the old device still holds, as long as fewer than a million changes
// are made to one question between two moves.
const moveSeqStride = 1_000_000

// Resume returns what the device needs to start or resume writing: the test
// (without correct answers or points; questions keep their order, and the
// options of a question with ShuffleOptions are shuffled in an order fixed per
// device), the answers stored for the device's participant, that
// participant's id, its seq base (moves × 1,000,000) and the device's status.
// It returns [ErrKicked] if the teacher sent the device back to the name
// picker and [ErrNotJoined] unless the device writes as a participant in the
// running sitting.
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
	res := wire.TestResponse{
		ParticipantID: p.id, Test: studentTest(e.cur.test, device), SeqBase: p.moves * moveSeqStride, Status: e.status(device),
	}
	e.mu.Unlock()

	rows, err := e.st.Q().ListParticipantAnswers(ctx, res.ParticipantID)
	if err != nil {
		return wire.TestResponse{}, err
	}
	res.Answers = make([]wire.StoredAnswer, 0, len(rows))
	for _, r := range rows {
		var value testfmt.Answer
		if err := json.Unmarshal([]byte(r.Value), &value); err != nil {
			return wire.TestResponse{}, err
		}
		res.Answers = append(res.Answers, wire.StoredAnswer{QuestionID: r.QuestionID, Answer: value, Seq: r.Seq})
	}
	return res, nil
}

func studentTest(t testfmt.Test, device string) wire.StudentTest {
	out := wire.StudentTest{Title: t.Title, Palette: t.Palette, Questions: make([]wire.StudentQuestion, len(t.Questions))}
	for i, q := range t.Questions {
		opts := make([]wire.StudentOption, len(q.Options))
		for j, o := range q.Options {
			opts[j] = wire.StudentOption{ID: o.ID, Content: o.Content, Image: o.Image}
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
