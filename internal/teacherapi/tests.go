package teacherapi

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/klatsfile"
	"github.com/andriykohut/klats/internal/mtf"
	"github.com/andriykohut/klats/internal/sitting"
	"github.com/andriykohut/klats/internal/store"
	"github.com/andriykohut/klats/internal/store/db"
	"github.com/andriykohut/klats/internal/testfmt"
	"github.com/andriykohut/klats/internal/wire"
)

func problemsOf(t testfmt.Test) []testfmt.Problem {
	if p := t.Problems(); p != nil {
		return p
	}
	return []testfmt.Problem{}
}

func (a *api) listTests(w http.ResponseWriter, r *http.Request) {
	rows, err := a.st.Q().ListTests(r.Context())
	if err != nil {
		fail(w, r, err)
		return
	}
	out := make([]wire.TestSummary, 0, len(rows))
	for _, row := range rows {
		s := wire.TestSummary{ID: row.ID, Title: row.Title, UpdatedAt: row.UpdatedAt}
		if t, err := testfmt.Decode([]byte(row.Doc)); err != nil {
			slog.Warn("teacherapi: stored test does not decode", "test", row.ID, "err", err)
		} else {
			s.QuestionCount, s.Blocking = len(t.Questions), t.HasBlocking()
		}
		out = append(out, s)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func testDoc(row db.Test) (wire.TestDoc, error) {
	t, err := testfmt.Decode([]byte(row.Doc))
	if err != nil {
		return wire.TestDoc{}, fmt.Errorf("stored test %s: %w", row.ID, err)
	}
	return wire.TestDoc{ID: row.ID, Test: t, Problems: problemsOf(t), SavedAt: row.UpdatedAt}, nil
}

func (a *api) createTest(w http.ResponseWriter, r *http.Request) {
	var req wire.NewTestRequest
	if !decode(w, r, &req) {
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = newTestTitle
	}
	a.insertTest(w, r, testfmt.Test{Version: 1, Title: title, Palette: testfmt.DefaultPalette, Settings: testfmt.DefaultSettings(), Questions: []testfmt.Question{}}, nil)
}

// duplicateTest stores a copy of the test titled as the request asks, or as
// the original when the title is empty.
func (a *api) duplicateTest(w http.ResponseWriter, r *http.Request) {
	var req wire.NewTestRequest
	if !decode(w, r, &req) {
		return
	}
	t, err := a.storedTest(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	t.Title = cmp.Or(strings.TrimSpace(req.Title), t.Title)
	a.insertTest(w, r, t, nil)
}

// exportTest sends the test as a .klats file named after its title, through
// [api.deliver]. A test whose media come to over 256 MiB is refused with 422
// "too_large", since [klatsfile.Read] would refuse the file.
func (a *api) exportTest(w http.ResponseWriter, r *http.Request) {
	t, err := a.storedTest(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	// shortcut: test.json and the zip headers are not counted, so media just
	// under the cap can still make a file Read refuses; count them if tests
	// that big turn up.
	var size int64
	for _, name := range t.Media() {
		f, _, err := a.media.Open(name)
		if err != nil {
			fail(w, r, err)
			return
		}
		info, err := f.Stat()
		_ = f.Close()
		if err != nil {
			fail(w, r, err)
			return
		}
		size += info.Size()
	}
	if size > maxKlatsBytes {
		httpx.Error(w, http.StatusUnprocessableEntity, "too_large")
		return
	}
	name := cmp.Or(httpx.SafeFileName(t.Title, maxFileTitleRunes), "Тест") + ".klats"
	a.deliver(w, r, name, "application/octet-stream", func(w io.Writer) error { return klatsfile.Write(w, t, a.media) }, nil)
}

// importTest opens the .klats or .mtf file in the request body as a new test,
// telling the two apart by the file's signature rather than its name. The body
// is capped at 256 MiB (413 "too_large") and spooled to a temporary file in the
// temp folder, which is removed whatever happens (see [api.spool]). A file that
// is not a valid test is a 422 "file_damaged", a .klats file from a newer
// version a 422 "test_too_new", and an .mtf file in the 2008–2012 layout a 422
// "file_too_old". The reply to an .mtf file carries the notes of [mtf.Open].
func (a *api) importTest(w http.ResponseWriter, r *http.Request) {
	tmp, size, ok := a.spool(w, r, maxKlatsBytes)
	if !ok {
		return
	}
	defer removeTemp(tmp)
	var head [14]byte
	n, _ := tmp.ReadAt(head[:], 0) // a short read leaves Sniff false, and klatsfile.Read reports the file
	var t testfmt.Test
	var notes []wire.OpenNote
	var err error
	if mtf.Sniff(head[:n]) {
		t, notes, err = mtf.Open(io.NewSectionReader(tmp, 0, size), a.media)
	} else {
		t, err = klatsfile.Read(tmp, size, a.media)
	}
	switch {
	case errors.Is(err, klatsfile.ErrDamaged), errors.Is(err, mtf.ErrDamaged):
		httpx.Error(w, http.StatusUnprocessableEntity, "file_damaged")
	case errors.Is(err, mtf.ErrOldLayout):
		httpx.Error(w, http.StatusUnprocessableEntity, "file_too_old")
	case err != nil:
		fail(w, r, err) // test_too_new, a failure of the media store, or a converter bug
	default:
		a.insertTest(w, r, t, notes)
	}
}

// insertTest stores t under a new id and replies 201 with its [wire.TestDoc],
// carrying notes.
func (a *api) insertTest(w http.ResponseWriter, r *http.Request, t testfmt.Test, notes []wire.OpenNote) {
	t.ID = store.NewID()
	doc, err := json.Marshal(t)
	if err != nil {
		fail(w, r, err)
		return
	}
	now := time.Now().UnixMilli()
	row := db.Test{ID: t.ID, Title: t.Title, Doc: string(doc), CreatedAt: now, UpdatedAt: now}
	err = a.st.Q().InsertTest(r.Context(), db.InsertTestParams{ID: row.ID, Title: row.Title, Doc: row.Doc, CreatedAt: now, UpdatedAt: now})
	if err != nil {
		fail(w, r, err)
		return
	}
	out, err := testDoc(row)
	if err != nil {
		fail(w, r, err)
		return
	}
	out.Notes = notes
	httpx.JSON(w, http.StatusCreated, out)
}

func (a *api) getTest(w http.ResponseWriter, r *http.Request) {
	row, err := a.st.Q().GetTest(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, r, err)
		return
	}
	out, err := testDoc(row)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) putTest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var raw json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	t, err := testfmt.Decode(raw)
	if errors.Is(err, testfmt.ErrTooNew) {
		fail(w, r, err)
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid")
		return
	}
	t.ID = id
	doc, err := json.Marshal(t)
	if err != nil {
		fail(w, r, err)
		return
	}
	now := time.Now().UnixMilli()
	n, err := a.st.Q().UpdateTest(r.Context(), db.UpdateTestParams{ID: id, Title: t.Title, Doc: string(doc), UpdatedAt: now})
	if err != nil || n == 0 {
		fail(w, r, cmp.Or(err, sitting.ErrNotFound))
		return
	}
	httpx.JSON(w, http.StatusOK, wire.SaveResult{Problems: problemsOf(t), SavedAt: now})
}

func (a *api) deleteTest(w http.ResponseWriter, r *http.Request) {
	n, err := a.st.Q().DeleteTest(r.Context(), r.PathValue("id"))
	if err == nil && n == 0 {
		err = sitting.ErrNotFound
	}
	noContent(w, r, err)
}
