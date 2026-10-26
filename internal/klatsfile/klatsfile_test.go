package klatsfile

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"math/rand/v2"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"klats/internal/media"
	"klats/internal/testfmt"
)

const pngHead = "\x89PNG\r\n\x1a\n"

// file returns head followed by tag, and its media name with extension ext.
func file(head, tag, ext string) ([]byte, string) {
	data := []byte(head + tag)
	sum := sha256.Sum256(data)
	return data, hex.EncodeToString(sum[:]) + "." + ext
}

func store(t *testing.T) (*media.Store, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "media")
	ms, err := media.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return ms, dir
}

func stored(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

type entry struct {
	name string
	data []byte
}

// zipOf returns a zip of the entries, in order and deflated.
func zipOf(t *testing.T, entries ...entry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		w, err := zw.Create(e.name)
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

// testJSON returns a test of the given format version whose one option shows
// the image src.
func testJSON(version int, src string) []byte {
	return fmt.Appendf(nil, `{"id":"t1","version":%d,"title":"Т","questions":[{"id":"q","type":"single","points":1,"options":[{"id":"o","correct":true,"image":{"src":%q,"w":8,"h":6}}]}]}`, version, src)
}

func read(b []byte, ms *media.Store) (testfmt.Test, error) {
	return Read(bytes.NewReader(b), int64(len(b)), ms)
}

func TestRoundTrip(t *testing.T) {
	src, _ := store(t)
	var names []string
	for _, f := range []struct{ head, tag, ext string }{{pngHead, "text", "png"}, {pngHead, "option", "png"}, {"ID3", "clip", "mp3"}} {
		data, want := file(f.head, f.tag, f.ext)
		if name, err := src.Put(bytes.NewReader(data)); err != nil || name != want {
			t.Fatalf("Put = %q, %v; want %q", name, err, want)
		}
		names = append(names, want)
	}
	raw := `{"id":"t1","version":1,"title":"Дроби","questions":[{"id":"q","type":"single","points":2,` +
		`"text":{"type":"doc","content":[{"type":"image","attrs":{"src":"` + names[0] + `","w":8,"h":6}},{"type":"audio","attrs":{"src":"` + names[2] + `"}}]},` +
		`"options":[{"id":"o","correct":true,"image":{"src":"` + names[1] + `","w":8,"h":6}}]}]}`
	want, err := testfmt.Decode([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := Write(&buf, want, src); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range zr.File {
		method := zip.Store
		if f.Name == "test.json" {
			method = zip.Deflate
		}
		if f.Method != method {
			t.Errorf("%s: method %d, want %d", f.Name, f.Method, method)
		}
	}

	dst, _ := store(t)
	got, err := read(buf.Bytes(), dst)
	if err != nil {
		t.Fatal(err)
	}
	want.ID = ""
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Read = %+v\nwant %+v", got, want)
	}
	for _, name := range names {
		f, _, err := dst.Open(name)
		if err != nil {
			t.Errorf("Open(%s): %v", name, err)
			continue
		}
		_ = f.Close()
	}
}

func TestWriteMissingMedia(t *testing.T) {
	ms, _ := store(t)
	_, name := file(pngHead, "gone", "png")
	tst, err := testfmt.Decode(testJSON(1, name))
	if err != nil {
		t.Fatal(err)
	}
	if err := Write(&bytes.Buffer{}, tst, ms); !errors.Is(err, media.ErrNotFound) {
		t.Errorf("Write = %v, want ErrNotFound", err)
	}
}

func TestReadSkipsUnreferenced(t *testing.T) {
	png, name := file(pngHead, "used", "png")
	extra, extraName := file(pngHead, "unused", "png")
	b := zipOf(t, entry{"test.json", testJSON(1, name)}, entry{"media/" + name, png}, entry{"media/" + extraName, extra})
	ms, dir := store(t)
	if _, err := read(b, ms); err != nil {
		t.Fatal(err)
	}
	if got := stored(t, dir); len(got) != 1 || got[0] != name {
		t.Errorf("store holds %v, want only %s", got, name)
	}
}

func TestReadUsesStoredMedia(t *testing.T) {
	png, name := file(pngHead, "kept", "png")
	ms, _ := store(t)
	if _, err := ms.Put(bytes.NewReader(png)); err != nil {
		t.Fatal(err)
	}
	if _, err := read(zipOf(t, entry{"test.json", testJSON(1, name)}), ms); err != nil {
		t.Errorf("Read = %v, want the stored image used", err)
	}
}

func TestReadRejects(t *testing.T) {
	png, pngName := file(pngHead, "a", "png")
	other, _ := file(pngHead, "b", "png")
	html, htmlName := file("<html><script>alert(1)</script>", "</html>", "png")
	bomb, bombName := file(pngHead, string(make([]byte, 10<<20+1-len(pngHead))), "png")
	valid := entry{"test.json", testJSON(1, pngName)}
	img := entry{"media/" + pngName, png}

	random := make([]byte, 4096)
	_, _ = rand.NewChaCha8([32]byte{}).Read(random)
	many := []entry{valid, img}
	for i := range 1999 {
		many = append(many, entry{name: fmt.Sprintf("media/%064x.png", i)})
	}
	// Trailing spaces keep the document valid JSON, so only the cap refuses it.
	bigJSON := append(testJSON(1, pngName), bytes.Repeat([]byte(" "), 4<<20)...)

	for name, b := range map[string][]byte{
		"random bytes":            random,
		"no test.json":            zipOf(t, img),
		"two test.json":           zipOf(t, valid, valid, img),
		"parent path":             zipOf(t, valid, img, entry{"../evil.png", png}),
		"media path escaping":     zipOf(t, valid, img, entry{"media/../../x.png", png}),
		"not a media name":        zipOf(t, valid, img, entry{"media/abc.png", png}),
		"other file":              zipOf(t, valid, img, entry{"other.txt", []byte("hi")}),
		"HTML named as a PNG":     zipOf(t, entry{"test.json", testJSON(1, htmlName)}, entry{"media/" + htmlName, html}),
		"hash differs from name":  zipOf(t, valid, entry{"media/" + pngName, other}),
		"media in neither":        zipOf(t, valid),
		"2,001 entries":           zipOf(t, many...),
		"test.json over 4 MiB":    zipOf(t, entry{"test.json", bigJSON}, img),
		"media entry over 10 MiB": zipOf(t, entry{"test.json", testJSON(1, bombName)}, entry{"media/" + bombName, bomb}),
	} {
		t.Run(name, func(t *testing.T) {
			ms, dir := store(t)
			if _, err := read(b, ms); !errors.Is(err, ErrDamaged) {
				t.Errorf("Read = %v, want ErrDamaged", err)
			}
			if got := stored(t, dir); len(got) != 0 {
				t.Errorf("store holds %v, want nothing", got)
			}
		})
	}
}

// A JPEG named .png passes the hash check and is caught only after Put has
// stored it under its own .jpg name, so this case is not in TestReadRejects.
func TestReadRejectsWrongExtension(t *testing.T) {
	jpg, name := file("\xff\xd8\xff", "photo", "png")
	ms, _ := store(t)
	_, err := read(zipOf(t, entry{"test.json", testJSON(1, name)}, entry{"media/" + name, jpg}), ms)
	if !errors.Is(err, ErrDamaged) {
		t.Errorf("Read = %v, want ErrDamaged", err)
	}
}

func TestReadTooNew(t *testing.T) {
	png, name := file(pngHead, "a", "png")
	ms, dir := store(t)
	_, err := read(zipOf(t, entry{"test.json", testJSON(2, name)}, entry{"media/" + name, png}), ms)
	if !errors.Is(err, testfmt.ErrTooNew) || errors.Is(err, ErrDamaged) {
		t.Errorf("Read = %v, want ErrTooNew", err)
	}
	if got := stored(t, dir); len(got) != 0 {
		t.Errorf("store holds %v, want nothing", got)
	}
}

func TestReadStoreFailure(t *testing.T) {
	png, name := file(pngHead, "a", "png")
	ms, dir := store(t)
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
	_, err := read(zipOf(t, entry{"test.json", testJSON(1, name)}, entry{"media/" + name, png}), ms)
	if !errors.Is(err, fs.ErrPermission) || errors.Is(err, ErrDamaged) {
		t.Errorf("Read = %v, want the store's permission error, not ErrDamaged", err)
	}
}
