// Package mediazip is the zip layout that .klats files and backups share, and
// the safe reading of it. Such a zip holds one main entry and media/<name> for
// each image and audio file, under its media store name and uncompressed. The
// files arrive by email or on flash drives, so reading caps every size itself,
// whatever the zip claims, and never stores a media file whose bytes do not
// match its name. Errors that a file's own bytes cause wrap [ErrInvalid], so
// callers can tell a bad file from a failure of the program's own storage.
package mediazip

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"

	"github.com/andriykohut/klats/internal/media"
	"github.com/andriykohut/klats/internal/rich"
)

const dir = "media/"

// ErrInvalid is wrapped by every error that a zip's own bytes cause.
var ErrInvalid = errors.New("mediazip: invalid")

// Open opens the zip of size bytes in r and returns its main entry, nil if it
// has none, and its media entries by media name. It reads no entry. It
// returns an error wrapping [ErrInvalid] for a file that is not a zip, a
// central directory that takes more than dirBytes to read, more than
// maxEntries entries, a repeated name, or a name other than main and
// media/<media name>.
func Open(r io.ReaderAt, size, dirBytes int64, maxEntries int, main string) (*zip.File, map[string]*zip.File, error) {
	// archive/zip reads directory headers until a bad one, whatever count the
	// file declares, so only a budget on its reads bounds the memory a crafted
	// directory costs before the entry cap can run.
	br := &budgetReader{ReaderAt: r, left: dirBytes, limit: dirBytes}
	zr, err := zip.NewReader(br, size)
	br.left = math.MaxInt64
	if err != nil {
		return nil, nil, invalid("%v", err)
	}
	if len(zr.File) > maxEntries {
		return nil, nil, invalid("%d entries", len(zr.File))
	}
	var head *zip.File
	files := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		name, inMedia := strings.CutPrefix(f.Name, dir)
		switch {
		case f.Name == main && head == nil:
			head = f
		case inMedia && rich.MediaKind(name) != "" && files[name] == nil:
			files[name] = f
		default:
			return nil, nil, invalid("entry %q", f.Name)
		}
	}
	return head, files, nil
}

// Copy copies the contents of f to w and returns how many bytes it copied. It
// reads at most limit+1 bytes, whatever size f's header claims, and returns an
// error wrapping [ErrInvalid] once it has, as it does for an entry it cannot
// read. An error from w is returned as it is.
func Copy(w io.Writer, f *zip.File, limit int64) (int64, error) {
	rc, err := f.Open()
	if err != nil {
		return 0, invalid("%s: %v", f.Name, err)
	}
	defer func() { _ = rc.Close() }()
	n, err := io.Copy(w, entryReader{io.LimitReader(rc, limit+1), f.Name})
	if err != nil {
		return n, err
	}
	if n > limit {
		return n, invalid("%s: over %d bytes", f.Name, limit)
	}
	return n, nil
}

// ReadAll returns the contents of f, with the errors of [Copy].
func ReadAll(f *zip.File, limit int64) ([]byte, error) {
	var b bytes.Buffer
	if _, err := Copy(&b, f, limit); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// Check reads media entry f, stored under the media name, and returns its
// size, storing nothing. An entry over limit bytes, or one whose bytes hash to
// another name, gives an error wrapping [ErrInvalid].
func Check(f *zip.File, name string, limit int64) (int64, error) {
	h := sha256.New()
	n, err := Copy(h, f, limit)
	if err != nil {
		return n, err
	}
	if hash, _, _ := strings.Cut(name, "."); hex.EncodeToString(h.Sum(nil)) != hash {
		return n, invalid("%s: content hashes differently", f.Name)
	}
	return n, nil
}

// Put stores media entry f, stored under the media name, in ms. Bytes that ms
// refuses or names differently, such as HTML or a JPEG called .png, give an
// error wrapping [ErrInvalid]; a failure of ms itself is returned wrapped.
func Put(ms *media.Store, f *zip.File, name string) error {
	rc, err := f.Open()
	if err != nil {
		return invalid("%s: %v", f.Name, err)
	}
	defer func() { _ = rc.Close() }()
	got, err := ms.Put(rc)
	switch {
	case errors.Is(err, media.ErrUnsupported), errors.Is(err, media.ErrTooLarge):
		return invalid("%s: %v", f.Name, err)
	case err != nil:
		return fmt.Errorf("mediazip: %w", err)
	case got != name:
		return invalid("%s: content is %s", f.Name, got)
	}
	return nil
}

// Add writes the file called name in ms to zw as media/<name>, uncompressed,
// because images and audio are compressed already. A file missing from ms is
// an error wrapping [media.ErrNotFound], and zw is left as it was then.
func Add(zw *zip.Writer, ms *media.Store, name string) error {
	f, _, err := ms.Open(name)
	if err != nil {
		return fmt.Errorf("mediazip: media %s: %w", name, err)
	}
	defer func() { _ = f.Close() }()
	fw, err := zw.CreateHeader(&zip.FileHeader{Name: dir + name, Method: zip.Store})
	if err != nil {
		return fmt.Errorf("mediazip: %w", err)
	}
	if _, err := io.Copy(fw, f); err != nil {
		return fmt.Errorf("mediazip: media %s: %w", name, err)
	}
	return nil
}

// entryReader reads the entry called name, wrapping its read errors in
// [ErrInvalid].
type entryReader struct {
	r    io.Reader
	name string
}

func (e entryReader) Read(p []byte) (int, error) {
	n, err := e.r.Read(p)
	if err != nil && err != io.EOF {
		err = invalid("%s: %v", e.name, err)
	}
	return n, err
}

// budgetReader fails every read once reads of limit bytes in all have been
// asked for; left is what remains of them.
type budgetReader struct {
	io.ReaderAt
	left, limit int64
}

func (b *budgetReader) ReadAt(p []byte, off int64) (int, error) {
	if b.left -= int64(len(p)); b.left < 0 {
		return 0, fmt.Errorf("central directory over %d bytes", b.limit)
	}
	return b.ReaderAt.ReadAt(p, off)
}

// invalid returns an error wrapping [ErrInvalid] that gives the reason.
func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}
