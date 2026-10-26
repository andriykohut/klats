package sitting

import (
	"encoding/json"
	"hash/fnv"
	"io"
	"math/rand/v2"
	"slices"

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
// (without correct answers or points; only the participant's own questions,
// which, with their order, are fixed per participant, so a move to another
// device keeps them, see questionsFor; the options of a question with
// ShuffleOptions are shuffled in an order fixed per device, as are those of
// ordering, grouping, word bank and label questions, and the right-hand
// targets of a matching question; an ordering question is never sent in its
// correct order; a highlight question's body comes as word nodes without
// target marks, see [testfmt.Question.Words]), the answers
// stored for the device's participant, that participant's id, its seq base
// (moves × 1,000,000) and the device's status. It returns [ErrKicked] if the
// teacher sent the device back to the name picker and [ErrNotJoined] unless
// the device writes as a participant in the running sitting.
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
		ParticipantID: p.id, Test: studentTest(e.cur.test, p.questions, device), SeqBase: p.moves * moveSeqStride, Status: e.status(device),
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

// studentTest returns the questions qs of the test t as the device gets them.
func studentTest(t testfmt.Test, qs []testfmt.Question, device string) wire.StudentTest {
	out := wire.StudentTest{Title: t.Title, Palette: t.Palette, Navigation: t.Settings.Navigation, Questions: make([]wire.StudentQuestion, len(qs))}
	for i, q := range qs {
		opts := make([]wire.StudentOption, len(q.Options))
		for j, o := range q.Options {
			opts[j] = wire.StudentOption{ID: o.ID, Content: o.Content, Image: o.Image}
		}
		switch {
		case q.Type == "order":
			shuffleOffKey(opts, q, device+q.ID)
		case q.ShuffleOptions || q.Type == "groups" || q.Type == "bank" || q.Type == "label":
			shuffle(opts, device+q.ID)
		}
		sq := wire.StudentQuestion{ID: q.ID, Type: q.Type, Text: q.Text, Options: opts, Image: q.Image}
		for _, g := range q.Targets {
			sq.Targets = append(sq.Targets, wire.StudentTarget{ID: g.ID, Content: g.Content, Image: g.Image, X: g.X, Y: g.Y})
		}
		if q.Type == "match" {
			shuffle(sq.Targets, device+q.ID+"#t")
		}
		switch q.Type {
		case "gaps":
			sq.Body = q.Body
			sq.Gaps = studentGaps(q, device)
		case "bank":
			sq.Body = q.Body
		case "highlight":
			words, _ := q.Words()
			sq.Body, _ = json.Marshal(words) // a rich.Doc holds nothing that fails to marshal
		}
		out.Questions[i] = sq
	}
	return out
}

// studentGaps lists the gaps of a gaps question in body order, each list gap
// with its choices in an order fixed per device and question. A typed gap has
// no choices.
func studentGaps(q testfmt.Question, device string) []wire.StudentGap {
	gaps := make([]wire.StudentGap, len(q.Gaps))
	for i, g := range q.Gaps {
		gaps[i].ID = g.ID
		for _, c := range g.Choices {
			gaps[i].Choices = append(gaps[i].Choices, wire.StudentChoice{ID: c.ID, Text: c.Text})
		}
		shuffle(gaps[i].Choices, device+q.ID+"#g:"+g.ID)
	}
	return gaps
}

// shuffleOffKey shuffles the options of an ordering question like [shuffle],
// then rotates them by one if that left them in the question's key order, so
// the correct order is never sent.
func shuffleOffKey(opts []wire.StudentOption, q testfmt.Question, key string) {
	shuffle(opts, key)
	if len(opts) > 1 && slices.EqualFunc(opts, q.Options, func(s wire.StudentOption, o testfmt.Option) bool { return s.ID == o.ID }) {
		first := opts[0]
		copy(opts, opts[1:])
		opts[len(opts)-1] = first
	}
}

// shuffle reorders list in an order fixed by the FNV-1a hash of key.
func shuffle[T any](list []T, key string) {
	h := fnv.New64a()
	_, _ = io.WriteString(h, key)
	seed := h.Sum64()
	rand.New(rand.NewPCG(seed, seed)).Shuffle(len(list), func(i, j int) { list[i], list[j] = list[j], list[i] })
}
