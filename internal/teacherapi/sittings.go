package teacherapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/skip2/go-qrcode"

	"klats/internal/httpx"
	"klats/internal/sitting"
	"klats/internal/sse"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

// storedTest returns the decoded stored test, or [sitting.ErrNotFound].
func (a *api) storedTest(ctx context.Context, id string) (testfmt.Test, error) {
	row, err := a.st.Q().GetTest(ctx, id)
	if err != nil {
		return testfmt.Test{}, err
	}
	t, err := testfmt.Decode([]byte(row.Doc))
	if err != nil {
		return testfmt.Test{}, fmt.Errorf("stored test %s: %w", id, err)
	}
	return t, nil
}

func replyProblems(w http.ResponseWriter, t testfmt.Test) {
	httpx.JSON(w, http.StatusConflict, wire.ProblemsError{Error: "has_problems", Problems: problemsOf(t)})
}

func (a *api) startSitting(w http.ResponseWriter, r *http.Request) {
	var req wire.StartRequest
	if !decode(w, r, &req) {
		return
	}
	t, err := a.storedTest(r.Context(), req.TestID)
	if err != nil {
		fail(w, r, err)
		return
	}
	if t.HasBlocking() {
		replyProblems(w, t)
		return
	}
	info, err := a.eng.Start(req.TestID, req.ClassID)
	if errors.Is(err, sitting.ErrHasProblems) {
		// The test was saved with problems after the check above.
		if t, err = a.storedTest(r.Context(), req.TestID); err == nil {
			replyProblems(w, t)
			return
		}
	}
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, info)
}

func (a *api) live(w http.ResponseWriter, r *http.Request) {
	snap, err := a.eng.Live()
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, snap)
}

func (a *api) endSitting(w http.ResponseWriter, r *http.Request) {
	noContent(w, r, a.eng.End())
}

// qr answers a PNG QR code of the query's text, such as the students' join
// link for the board view: 1 to 512 bytes, or a 400.
func (a *api) qr(w http.ResponseWriter, r *http.Request) {
	text := r.URL.Query().Get("text")
	if text == "" || len(text) > maxQRBytes {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	img, err := qrcode.Encode(text, qrcode.Medium, qrPixels)
	if err != nil {
		fail(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(img)
}

// events streams the teacher's "live" hints until the client leaves.
func (a *api) events(w http.ResponseWriter, r *http.Request) {
	ch, unsubscribe := a.hub.Subscribe("teacher")
	defer unsubscribe()
	if err := sse.Stream(w, r, ch, keepAliveTime); err != nil {
		slog.Warn("teacherapi: event stream ended", "err", err)
	}
}
