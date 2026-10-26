// Package klatsfile reads and writes .klats files, the zip archives teachers
// share tests in. A .klats file holds test.json, the test document, and
// media/<name> for each image and audio file the test uses, under its media
// store name. Files arrive by email or on flash drives, so [Read] is the trust
// boundary for opened tests: it caps every size itself, allows no other entry,
// and stores nothing until every check that does not need the media store has
// passed.
package klatsfile

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"

	"klats/internal/media"
	"klats/internal/rich"
	"klats/internal/testfmt"
)

const (
	testEntry = "test.json"
	mediaDir  = "media/"

	maxFileBytes = 256 << 20
	maxTestBytes = 4 << 20
	maxEntries   = 2000
	// maxDirBytes caps what zip.NewReader reads: the central directory and its
	// end record. 2,000 entries with 400 bytes of extra fields and comments
	// each fit in it.
	maxDirBytes = 1 << 20
	// maxMediaBytes is the media store's largest cap, the one for audio.
	maxMediaBytes = 10 << 20
)

// ErrDamaged is returned by [Read] for a file that is not a valid .klats file.
var ErrDamaged = errors.New("klatsfile: not a valid test file")

// Write writes t to w as a .klats file: test.json, the test with its ID
// emptied, deflated, and media/<name> for each file t uses, copied from ms
// uncompressed because images and audio are compressed already. A file t uses
// that is missing from ms is an error wrapping [media.ErrNotFound]; w may
// already hold part of the file then.
func Write(w io.Writer, t testfmt.Test, ms *media.Store) error {
	t.ID = ""
	doc, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("klatsfile: %w", err)
	}
	zw := zip.NewWriter(w)
	fw, err := zw.Create(testEntry)
	if err != nil {
		return fmt.Errorf("klatsfile: %w", err)
	}
	if _, err := fw.Write(doc); err != nil {
		return fmt.Errorf("klatsfile: %w", err)
	}
	for _, name := range t.Media() {
		if err := writeMedia(zw, ms, name); err != nil {
			return err
		}
	}
	if err := zw.Close(); err != nil {
		return fmt.Errorf("klatsfile: %w", err)
	}
	return nil
}

func writeMedia(zw *zip.Writer, ms *media.Store, name string) error {
	f, _, err := ms.Open(name)
	if err != nil {
		return fmt.Errorf("klatsfile: media %s: %w", name, err)
	}
	defer func() { _ = f.Close() }()
	fw, err := zw.CreateHeader(&zip.FileHeader{Name: mediaDir + name, Method: zip.Store})
	if err != nil {
		return fmt.Errorf("klatsfile: %w", err)
	}
	if _, err := io.Copy(fw, f); err != nil {
		return fmt.Errorf("klatsfile: media %s: %w", name, err)
	}
	return nil
}

// Read reads the .klats file of size bytes in r, stores in ms the media its
// test uses and returns the decoded test with an empty ID. A file the test uses
// may be missing from the zip if ms already holds it; entries the test does not
// use are ignored. Read returns an error wrapping [testfmt.ErrTooNew] for a
// test from a newer version, and one wrapping [ErrDamaged] for a file over
// 256 MiB, one that is not a zip, a central directory over 1 MiB, more than
// 2,000 entries, an entry other than test.json and media/<media name>, a
// repeated entry, a test.json that is missing, over 4 MiB or refused by
// [testfmt.Decode], a file the test uses that neither the zip nor ms holds,
// media the test uses of over 256 MiB in all, and a media entry over 10 MiB,
// whose bytes hash to another name, or that [media.Store.Put] refuses or names
// differently. A failure of ms itself, such as a full disk, is returned wrapped
// instead of as ErrDamaged. Only media that Put refuses or names differently,
// and a failure of ms, can leave earlier media of the file stored; every other
// error stores nothing.
func Read(r io.ReaderAt, size int64, ms *media.Store) (testfmt.Test, error) {
	// Every check that needs no Put runs before the first one. Media stored
	// ahead of a later refusal does no harm: its name is its content hash.
	if size > maxFileBytes {
		return testfmt.Test{}, damaged("file of %d bytes", size)
	}
	// archive/zip reads directory headers until a bad one, whatever count the
	// file declares, so only a budget on its reads bounds the memory a crafted
	// directory costs before the entry cap can run.
	br := &budgetReader{ReaderAt: r, left: maxDirBytes}
	zr, err := zip.NewReader(br, size)
	br.left = math.MaxInt64
	if err != nil {
		return testfmt.Test{}, damaged("%v", err)
	}
	if len(zr.File) > maxEntries {
		return testfmt.Test{}, damaged("%d entries", len(zr.File))
	}
	entries := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		name, inMedia := strings.CutPrefix(f.Name, mediaDir)
		if f.Name != testEntry && (!inMedia || rich.MediaKind(name) == "") || entries[f.Name] != nil {
			return testfmt.Test{}, damaged("entry %q", f.Name)
		}
		entries[f.Name] = f
	}
	if entries[testEntry] == nil {
		return testfmt.Test{}, damaged("no %s", testEntry)
	}
	raw, err := readCapped(entries[testEntry], maxTestBytes)
	if err != nil {
		return testfmt.Test{}, damaged("%s: %v", testEntry, err)
	}
	t, err := testfmt.Decode(raw)
	if errors.Is(err, testfmt.ErrTooNew) {
		return testfmt.Test{}, err
	}
	if err != nil {
		return testfmt.Test{}, damaged("%v", err)
	}
	t.ID = ""

	var bundled []*zip.File
	// total caps the bytes a small file can inflate to on disk: each entry
	// alone may be 10 MiB, and a test may use 2,000 of them.
	var total int64
	for _, name := range t.Media() {
		f := entries[mediaDir+name]
		if f == nil {
			if err := checkStored(ms, name); err != nil {
				return testfmt.Test{}, err
			}
			continue
		}
		data, err := readCapped(f, maxMediaBytes)
		if err != nil {
			return testfmt.Test{}, damaged("%s: %v", f.Name, err)
		}
		if total += int64(len(data)); total > maxFileBytes {
			return testfmt.Test{}, damaged("media over %d bytes in all", maxFileBytes)
		}
		hash, _, _ := strings.Cut(name, ".")
		if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != hash {
			return testfmt.Test{}, damaged("%s: content hashes differently", f.Name)
		}
		bundled = append(bundled, f)
	}

	for _, f := range bundled {
		if err := put(ms, f); err != nil {
			return testfmt.Test{}, err
		}
	}
	return t, nil
}

// checkStored returns nil if ms holds name, an error wrapping [ErrDamaged] if
// it does not, and the store's own error wrapped if it fails.
func checkStored(ms *media.Store, name string) error {
	f, _, err := ms.Open(name)
	if errors.Is(err, media.ErrNotFound) {
		return damaged("media %s missing", name)
	}
	if err != nil {
		return fmt.Errorf("klatsfile: %w", err)
	}
	return f.Close()
}

// readCapped returns the contents of f, or an error if they run over limit
// bytes; it reads at most limit+1 of them, whatever size f's header claims.
func readCapped(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = rc.Close() }()
	data, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("over %d bytes", limit)
	}
	return data, nil
}

// put stores media entry f in ms. Bytes that ms refuses or names differently
// from the entry, such as HTML or a JPEG called .png, give an error wrapping
// [ErrDamaged]; a failure of ms itself is returned wrapped.
func put(ms *media.Store, f *zip.File) error {
	rc, err := f.Open()
	if err != nil {
		return damaged("%s: %v", f.Name, err)
	}
	defer func() { _ = rc.Close() }()
	name, err := ms.Put(rc)
	switch {
	case errors.Is(err, media.ErrUnsupported), errors.Is(err, media.ErrTooLarge):
		return damaged("%s: %v", f.Name, err)
	case err != nil:
		return fmt.Errorf("klatsfile: %w", err)
	case mediaDir+name != f.Name:
		return damaged("%s: content is %s", f.Name, name)
	}
	return nil
}

// budgetReader fails every read once reads of left bytes have been asked for.
type budgetReader struct {
	io.ReaderAt
	left int64
}

func (b *budgetReader) ReadAt(p []byte, off int64) (int, error) {
	if b.left -= int64(len(p)); b.left < 0 {
		return 0, fmt.Errorf("central directory over %d bytes", maxDirBytes)
	}
	return b.ReaderAt.ReadAt(p, off)
}

// damaged returns an error wrapping [ErrDamaged] that gives the reason.
func damaged(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrDamaged, fmt.Sprintf(format, args...))
}
