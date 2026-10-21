package sitting

import (
	"hash/fnv"
	"io"
	"math/rand/v2"

	"klats/internal/testfmt"
	"klats/internal/wire"
)

// TestFor returns the running test as the device's participant sees it,
// without correct answers or points. Questions keep their order; the options
// of a question with ShuffleOptions are shuffled in an order fixed per device.
// It returns [ErrNotJoined] unless the device writes as a participant.
func (e *Engine) TestFor(device string) (wire.StudentTest, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil || e.cur.onDevice(device) == nil {
		return wire.StudentTest{}, ErrNotJoined
	}
	if err := e.touch(device); err != nil {
		return wire.StudentTest{}, err
	}
	return studentTest(e.cur.test, device), nil
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
