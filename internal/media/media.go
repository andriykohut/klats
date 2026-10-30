// Package media is the store for the images and audio of tests: files named
// by the SHA-256 of their bytes, so a name never changes meaning and the same
// upload is stored once. The type of a file is sniffed from its bytes; an
// extension or header supplied by a client is never trusted.
package media

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"klats/internal/rich"
)

const (
	maxImageBytes = 5 << 20
	maxAudioBytes = 10 << 20
	// svgWindow is how far into a file an SVG's root element may start.
	svgWindow = 8 << 10
)

var (
	// ErrUnsupported is returned by [Store.Put] for bytes that are not a
	// supported image or audio file, HTML included.
	ErrUnsupported = errors.New("media: unsupported file type")
	// ErrTooLarge is returned by [Store.Put] for an image over 5 MiB or audio
	// over 10 MiB.
	ErrTooLarge = errors.New("media: file too large")
	// ErrNotFound is returned by [Store.Open] for a missing file and for a
	// name that is not a media name.
	ErrNotFound = errors.New("media: not found")
)

var contentTypes = map[string]string{
	"jpg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
	"mp3": "audio/mpeg", "m4a": "audio/mp4", "ogg": "audio/ogg", "wav": "audio/wav",
}

// Store is a folder of media files. It is safe for concurrent use.
type Store struct {
	dir string
}

// Open returns the store in dir, creating the folder if it is missing.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("media: %w", err)
	}
	return &Store{dir: dir}, nil
}

// Put stores the bytes of r as "<sha256 hex>.<ext>" and returns that name; the
// extension follows the sniffed type. Storing the same bytes again returns the
// same name and writes nothing. It returns [ErrUnsupported] or [ErrTooLarge],
// and an error from r wrapped, so a caller can recognise a capped body with
// [errors.As].
func (s *Store) Put(r io.Reader) (string, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxAudioBytes+1))
	if err != nil {
		return "", fmt.Errorf("media: read upload: %w", err)
	}
	ext := sniff(data)
	if ext == "" {
		return "", ErrUnsupported
	}
	limit := maxAudioBytes
	if slices.Contains([]string{"jpg", "png", "gif", "webp", "svg"}, ext) {
		limit = maxImageBytes
	}
	if len(data) > limit {
		return "", ErrTooLarge
	}
	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:]) + "." + ext
	path := filepath.Join(s.dir, name)
	if _, err := os.Stat(path); err == nil {
		return name, nil
	}
	tmp, err := os.CreateTemp(s.dir, ".upload-*")
	if err != nil {
		return "", fmt.Errorf("media: %w", err)
	}
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		_ = os.Remove(tmp.Name())
		return "", fmt.Errorf("media: write: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return "", fmt.Errorf("media: %w", err)
	}
	return name, nil
}

// Open returns the stored file called name and its content type. The caller
// closes the file. It returns [ErrNotFound] for a missing file and for any name
// that [rich.MediaKind] rejects, so no other path in the data folder is
// reachable through it.
func (s *Store) Open(name string) (*os.File, string, error) {
	if rich.MediaKind(name) == "" {
		return nil, "", ErrNotFound
	}
	f, err := os.Open(filepath.Join(s.dir, name))
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", fmt.Errorf("media: %w", err)
	}
	_, ext, _ := strings.Cut(name, ".")
	return f, contentTypes[ext], nil
}

// sniff returns the extension for the type of data's leading bytes, or "" for
// an unsupported type. An SVG is XML whose first element is <svg>, with only a
// byte order mark, processing instructions such as the XML declaration,
// comments, a doctype and whitespace before it; that element must start
// within the first 8 KiB, while its start tag may run on, as draw.io's export
// does with its copy of the diagram in an attribute.
func sniff(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("\xff\xd8\xff")):
		return "jpg"
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		return "png"
	case bytes.HasPrefix(b, []byte("GIF8")):
		return "gif"
	case riff(b, "WEBP"):
		return "webp"
	case riff(b, "WAVE"):
		return "wav"
	case bytes.HasPrefix(b, []byte("OggS")):
		return "ogg"
	case bytes.HasPrefix(b, []byte("ID3")), len(b) >= 2 && b[0] == 0xff && b[1]&0xe0 == 0xe0:
		return "mp3"
	case len(b) >= 12 && string(b[4:8]) == "ftyp" && (string(b[8:12]) == "M4A " || string(b[8:12]) == "isom" || string(b[8:12]) == "mp42"):
		return "m4a"
	case svgRoot(b):
		return "svg"
	}
	return ""
}

// svgRoot reports whether the first element of b is <svg>, as [sniff] defines
// it.
func svgRoot(b []byte) bool {
	d := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))))
	// Only the root's ASCII name is read, so any declared encoding will do, and
	// an entity the doctype declares, as Illustrator's exports use in the
	// root's attributes, can stay unexpanded.
	d.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	d.Strict = false
	for d.InputOffset() < svgWindow {
		tok, err := d.RawToken()
		if err != nil {
			return false
		}
		switch t := tok.(type) {
		case xml.StartElement:
			return t.Name.Local == "svg"
		case xml.CharData:
			if len(bytes.TrimSpace(t)) > 0 {
				return false
			}
		}
	}
	return false
}

// riff reports whether b is a RIFF container of the given form type.
func riff(b []byte, form string) bool {
	return len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == form
}
