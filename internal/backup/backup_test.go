package backup

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io/fs"
	"math/rand/v2"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"klats/internal/events"
	"klats/internal/media"
	"klats/internal/rich"
	"klats/internal/sitting"
	"klats/internal/store"
	"klats/internal/store/db"
	"klats/internal/testfmt"
	"klats/internal/wire"
)

const pngHead = "\x89PNG\r\n\x1a\n"

// file returns head followed by tag, and its media name with extension ext.
func file(head, tag, ext string) ([]byte, string) {
	data := []byte(head + tag)
	sum := sha256.Sum256(data)
	return data, hex.EncodeToString(sum[:]) + "." + ext
}

// folder is a data folder: its database, its media store and its tmp/.
type folder struct {
	st       *store.Store
	ms       *media.Store
	mediaDir string
	tmp      string
}

func newFolder(t *testing.T) *folder {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "klats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	f := &folder{st: st, mediaDir: filepath.Join(dir, "media"), tmp: filepath.Join(dir, "tmp")}
	if f.ms, err = media.Open(f.mediaDir); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(f.tmp, 0o700); err != nil {
		t.Fatal(err)
	}
	return f
}

func names(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

// clean fails the test unless f's media store and tmp/ are empty.
func (f *folder) clean(t *testing.T) {
	t.Helper()
	if got := names(t, f.mediaDir); len(got) != 0 {
		t.Errorf("media store holds %v, want nothing", got)
	}
	if got := names(t, f.tmp); len(got) != 0 {
		t.Errorf("tmp holds %v, want nothing", got)
	}
}

// prepare runs Prepare on the backup b for f, and closes what it prepared when
// the test ends.
func (f *folder) prepare(t *testing.T, b []byte) (*Prepared, error) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "in.klatsbackup")
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
	p, err := Prepare(path, f.ms, f.tmp)
	if p != nil {
		t.Cleanup(func() { _ = p.Close() })
	}
	return p, err
}

type entry struct {
	name string
	data []byte
}

// zipOf returns a zip of the entries, in order: deflated, or stored when
// empty.
func zipOf(t *testing.T, entries ...entry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		method := zip.Deflate
		if len(e.data) == 0 {
			method = zip.Store
		}
		w, err := zw.CreateHeader(&zip.FileHeader{Name: e.name, Method: method})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(e.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// dbFile returns the bytes of a fresh database after the statements in edit
// have run on it.
func dbFile(t *testing.T, edit ...string) []byte {
	t.Helper()
	path := filepath.Join(t.TempDir(), "klats.db")
	st, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range edit {
		if _, err := conn.Exec(q); err != nil {
			t.Fatalf("%.80s: %v", q, err)
		}
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// testDoc returns a test document of the given format version whose question
// shows or plays the media files called names.
func testDoc(version int, names ...string) string {
	var nodes []string
	for _, n := range names {
		if rich.MediaKind(n) == "audio" {
			nodes = append(nodes, `{"type":"audio","attrs":{"src":"`+n+`"}}`)
		} else {
			nodes = append(nodes, `{"type":"image","attrs":{"src":"`+n+`","w":8,"h":6}}`)
		}
	}
	return fmt.Sprintf(`{"version":%d,"title":"Т","questions":[{"id":"q","type":"single","points":1,"text":{"type":"doc","content":[%s]},"options":[{"id":"o","correct":true}]}]}`,
		version, strings.Join(nodes, ","))
}

// insertTest is the statement that stores doc as test t1.
func insertTest(doc string) string {
	return `INSERT INTO tests (id, title, doc, created_at, updated_at) VALUES ('t1', 'Т', '` + doc + `', 0, 0)`
}

func TestBackupRoundTrip(t *testing.T) {
	a := newFolder(t)
	img, name := file(pngHead, "used", "png")
	unused, unusedName := file(pngHead, "unused", "png")
	for _, data := range [][]byte{img, unused} {
		if _, err := a.ms.Put(bytes.NewReader(data)); err != nil {
			t.Fatal(err)
		}
	}
	text := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Так?"}]}]}`)
	doc, err := json.Marshal(testfmt.Test{ID: "t1", Version: 1, Title: "Фото", Palette: "teal", Questions: []testfmt.Question{{
		ID: "q1", Type: "single", Text: text, Points: 2,
		Options: []testfmt.Option{{ID: "o0", Content: text, Correct: true, Image: &testfmt.Image{Src: name, W: 8, H: 6}}, {ID: "o1", Content: text}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := a.st.Q().InsertTest(ctx, db.InsertTestParams{ID: "t1", Title: "Фото", Doc: string(doc)}); err != nil {
		t.Fatal(err)
	}
	if err := a.st.Q().InsertClass(ctx, db.InsertClassParams{ID: "c1", Name: "7-А"}); err != nil {
		t.Fatal(err)
	}
	if err := a.st.Q().InsertStudent(ctx, db.InsertStudentParams{ID: "s1", ClassID: "c1", Name: "Бойко Андрій", SortKey: "бойко"}); err != nil {
		t.Fatal(err)
	}

	eng, err := sitting.New(a.st, events.New(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	class := "c1"
	info, err := eng.Start("t1", &class, 0)
	if err != nil {
		t.Fatal(err)
	}
	const device = "aaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := eng.Join(info.Code, device, "10.0.0.7"); err != nil {
		t.Fatal(err)
	}
	p, err := eng.Pick(info.Code, device, wire.PickRequest{StudentID: "s1"})
	if err != nil {
		t.Fatal(err)
	}
	change := wire.AnswerChange{ChangeID: "c1", ParticipantID: p.ID, QuestionID: "q1", Answer: testfmt.Answer{Items: []string{"o0"}}, Seq: 1}
	if _, err := eng.Submit(device, []wire.AnswerChange{change}, 0); err != nil {
		t.Fatal(err)
	}
	if err := eng.End(); err != nil {
		t.Fatal(err)
	}
	want, err := eng.Results(info.AssignmentID)
	if err != nil {
		t.Fatal(err)
	}
	if len(want.Rows) != 1 || want.Rows[0].Grade != 12 {
		t.Fatalf("results before the backup = %+v, want one row graded 12", want.Rows)
	}

	var buf bytes.Buffer
	if err := Write(&buf, a.st, a.ms, a.tmp); err != nil {
		t.Fatal(err)
	}
	if got := names(t, a.tmp); len(got) != 0 {
		t.Errorf("Write left %v in tmp", got)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var listed []string
	for _, f := range zr.File {
		listed = append(listed, fmt.Sprintf("%s %d", f.Name, f.Method))
	}
	if wantListed := []string{"klats.db 8", "media/" + name + " 0"}; !reflect.DeepEqual(listed, wantListed) {
		t.Errorf("the backup holds %v, want %v", listed, wantListed)
	}

	b := newFolder(t)
	prep, err := b.prepare(t, buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := prep.Apply(b.st); err != nil {
		t.Fatal(err)
	}
	if err := prep.Close(); err != nil {
		t.Fatal(err)
	}
	if got := names(t, b.tmp); len(got) != 0 {
		t.Errorf("Close left %v in tmp", got)
	}
	if tests, err := b.st.Q().ListTests(ctx); err != nil || len(tests) != 1 || tests[0].Title != "Фото" {
		t.Errorf("tests = %+v, %v", tests, err)
	}
	if classes, err := b.st.Q().ListClasses(ctx); err != nil || len(classes) != 1 || classes[0].Name != "7-А" {
		t.Errorf("classes = %+v, %v", classes, err)
	}
	engB, err := sitting.New(b.st, events.New(), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := engB.Results(info.AssignmentID); err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("results after the restore = %+v, %v\nwant %+v", got, err, want)
	}
	f, _, err := b.ms.Open(name)
	if err != nil {
		t.Fatalf("the image does not open: %v", err)
	}
	_ = f.Close()
	if _, _, err := b.ms.Open(unusedName); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("the unused file was restored: %v", err)
	}
}

// Write leaves out a used file the media store lacks, and the backup still
// restores.
func TestBackupMissingMedia(t *testing.T) {
	a := newFolder(t)
	_, name := file(pngHead, "gone", "png")
	if err := a.st.Q().InsertTest(context.Background(), db.InsertTestParams{ID: "t1", Title: "Т", Doc: testDoc(1, name)}); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := Write(&buf, a.st, a.ms, a.tmp); err != nil {
		t.Fatal(err)
	}
	b := newFolder(t)
	p, err := b.prepare(t, buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Apply(b.st); err != nil {
		t.Fatal(err)
	}
}

// clips returns a backup whose test plays n different audio clips of 10 MiB
// each, deflated to a few KiB apiece.
func clips(t *testing.T, n int) []byte {
	t.Helper()
	clip := make([]byte, maxMediaBytes)
	copy(clip, "ID3")
	// The clips differ only in bytes 3 and 4. Each entry is those five bytes
	// in a stored, non-final deflate block, then the rest, all zeros,
	// compressed once.
	var zeros bytes.Buffer
	fw, err := flate.NewWriter(&zeros, flate.BestCompression)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(clip[5:]); err != nil {
		t.Fatal(err)
	}
	if err := fw.Close(); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	var used []string
	for i := range n {
		clip[3], clip[4] = byte(i), byte(i>>8)
		sum := sha256.Sum256(clip)
		name := hex.EncodeToString(sum[:]) + ".mp3"
		used = append(used, name)
		raw := append([]byte{0, 5, 0, 0xfa, 0xff}, clip[:5]...)
		raw = append(raw, zeros.Bytes()...)
		w, err := zw.CreateRaw(&zip.FileHeader{
			Name: "media/" + name, Method: zip.Deflate, CRC32: crc32.ChecksumIEEE(clip),
			CompressedSize64: uint64(len(raw)), UncompressedSize64: uint64(len(clip)),
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(raw); err != nil {
			t.Fatal(err)
		}
	}
	w, err := zw.Create("klats.db")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(dbFile(t, insertTest(testDoc(1, used...)))); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// mediaEntries returns n empty entries under the longest media names.
func mediaEntries(n int) []entry {
	out := make([]entry, n)
	for i := range out {
		out[i] = entry{name: fmt.Sprintf("media/%064x.webp", i)}
	}
	return out
}

func TestPrepareRejects(t *testing.T) {
	img, name := file(pngHead, "a", "png")
	other, _ := file(pngHead, "b", "png")
	good := entry{"klats.db", dbFile(t, insertTest(testDoc(1, name)))}
	random := make([]byte, 4096)
	_, _ = rand.NewChaCha8([32]byte{}).Read(random)

	// A page of the devices table, which nothing but the integrity check
	// reads, overwritten.
	corrupt := dbFile(t, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300)
		INSERT INTO devices (token, label, last_seen_at) SELECT 'd' || i, printf('%.1000c', 'x'), 0 FROM n`)
	page := len(corrupt) / 4096 / 2 * 4096
	copy(corrupt[page:page+4096], bytes.Repeat([]byte{0xff}, 4096))

	for name, b := range map[string][]byte{
		"not a zip":                    random,
		"no klats.db":                  zipOf(t, entry{"media/" + name, img}),
		"two klats.db":                 zipOf(t, good, good),
		"an extra notes.txt":           zipOf(t, good, entry{"notes.txt", []byte("hi")}),
		"a parent path":                zipOf(t, good, entry{"../" + name, img}),
		"klats.db that isn't SQLite":   zipOf(t, entry{"klats.db", random}),
		"a corrupt page":               zipOf(t, entry{"klats.db", corrupt}),
		"a test that fails Decode":     zipOf(t, entry{"klats.db", dbFile(t, insertTest(`{"version":1,"title":"Т","questions":[{"id":"q","type":"nope"}]}`))}),
		"a snapshot that fails Decode": zipOf(t, entry{"klats.db", dbFile(t, `INSERT INTO assignments (id, test_snapshot, created_at) VALUES ('a1', '{"version":1,"questions":[{"type":"nope"}]}', 0)`)}),
		"hash differs from name":       zipOf(t, good, entry{"media/" + name, other}),
		"50,001 entries":               zipOf(t, append([]entry{good}, mediaEntries(maxEntries)...)...),
		"media over 2 GiB":             clips(t, maxMediaTotal/maxMediaBytes+1),
	} {
		t.Run(name, func(t *testing.T) {
			f := newFolder(t)
			if _, err := f.prepare(t, b); !errors.Is(err, ErrDamaged) {
				t.Errorf("Prepare = %v, want ErrDamaged", err)
			}
			f.clean(t)
		})
	}
}

// A directory of 50,000 entries with the longest media names fits in the
// directory budget.
func TestPrepareFullDirectory(t *testing.T) {
	good := entry{"klats.db", dbFile(t)}
	f := newFolder(t)
	if _, err := f.prepare(t, zipOf(t, append([]entry{good}, mediaEntries(maxEntries-1)...)...)); err != nil {
		t.Errorf("Prepare = %v", err)
	}
}

func TestPrepareTooNew(t *testing.T) {
	for name, c := range map[string]struct {
		db    []byte
		cause error
	}{
		"newer schema":      {dbFile(t, `INSERT INTO goose_db_version (version_id, is_applied) VALUES (99, 1)`), store.ErrSchemaTooNew},
		"newer test format": {dbFile(t, insertTest(testDoc(2))), testfmt.ErrTooNew},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFolder(t)
			_, err := f.prepare(t, zipOf(t, entry{"klats.db", c.db}))
			if !errors.Is(err, ErrTooNew) || !errors.Is(err, c.cause) || errors.Is(err, ErrDamaged) {
				t.Errorf("Prepare = %v, want ErrTooNew wrapping %v", err, c.cause)
			}
			f.clean(t)
		})
	}
}

// A backup of a database at migration 2, before sittings.ends_at, is migrated
// and applies.
func TestPrepareMigratesOlder(t *testing.T) {
	old := dbFile(t,
		`ALTER TABLE participants DROP COLUMN extra_ms`,
		`ALTER TABLE sittings DROP COLUMN ends_at`,
		`DELETE FROM goose_db_version WHERE version_id > 2`,
		insertTest(testDoc(1)),
		`INSERT INTO assignments (id, test_snapshot, created_at) VALUES ('a1', '`+testDoc(1)+`', 1)`,
		`INSERT INTO sittings (id, assignment_id, join_code, started_at, ended_at) VALUES ('si1', 'a1', '1234', 1, 2)`,
	)
	f := newFolder(t)
	p, err := f.prepare(t, zipOf(t, entry{"klats.db", old}))
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Apply(f.st); err != nil {
		t.Fatal(err)
	}
	s, err := f.st.Q().GetLatestSitting(context.Background())
	if err != nil || s.ID != "si1" || s.EndsAt.Valid {
		t.Errorf("latest sitting = %+v, %v; want si1 with no ends_at", s, err)
	}
}

func TestPrepareStoreFailure(t *testing.T) {
	img, name := file(pngHead, "a", "png")
	f := newFolder(t)
	if err := os.Chmod(f.mediaDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(f.mediaDir, 0o700) })
	_, err := f.prepare(t, zipOf(t, entry{"klats.db", dbFile(t, insertTest(testDoc(1, name)))}, entry{"media/" + name, img}))
	if !errors.Is(err, fs.ErrPermission) || errors.Is(err, ErrDamaged) {
		t.Errorf("Prepare = %v, want the store's permission error, not ErrDamaged", err)
	}
	if got := names(t, f.tmp); len(got) != 0 {
		t.Errorf("tmp holds %v, want nothing", got)
	}
}
