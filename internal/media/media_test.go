package media

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var (
	pngHead  = []byte("\x89PNG\r\n\x1a\n")
	riffWebp = []byte("RIFF\x00\x00\x00\x00WEBP")
	svgHead  = []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3">`)
)

func padded(head []byte, n int) []byte {
	return append(append([]byte{}, head...), make([]byte, n-len(head))...)
}

func open(t *testing.T) (*Store, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "media")
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	return s, dir
}

func TestPutSniffsAndNames(t *testing.T) {
	s, dir := open(t)
	data := padded(pngHead, 100)
	sum := sha256.Sum256(data)
	want := hex.EncodeToString(sum[:]) + ".png"
	for range 2 {
		name, err := s.Put(bytes.NewReader(data))
		if err != nil || name != want {
			t.Fatalf("Put = %q, %v; want %q", name, err, want)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != want {
		t.Fatalf("media folder = %v, %v; want only %s", entries, err, want)
	}
	got, err := os.ReadFile(filepath.Join(dir, want))
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("stored bytes differ: %v", err)
	}
}

func TestPutRejectsUnknown(t *testing.T) {
	s, dir := open(t)
	for _, in := range []string{`<?xml version="1.0"?><note/>`, "<html><script>1</script></html>", "", "RIFF\x00\x00\x00\x00AVI "} {
		if _, err := s.Put(strings.NewReader(in)); !errors.Is(err, ErrUnsupported) {
			t.Errorf("Put(%q) = %v, want ErrUnsupported", in, err)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("rejected uploads left files: %v", entries)
	}
}

func TestPutCaps(t *testing.T) {
	s, dir := open(t)
	const mib = 1 << 20
	if _, err := s.Put(bytes.NewReader(padded(pngHead, 5*mib+1))); !errors.Is(err, ErrTooLarge) {
		t.Errorf("5 MiB+1 PNG: %v, want ErrTooLarge", err)
	}
	if _, err := s.Put(bytes.NewReader(padded(pngHead, 5*mib))); err != nil {
		t.Errorf("5 MiB PNG: %v", err)
	}
	if _, err := s.Put(bytes.NewReader(padded(svgHead, 5*mib+1))); !errors.Is(err, ErrTooLarge) {
		t.Errorf("5 MiB+1 SVG: %v, want ErrTooLarge", err)
	}
	if name, err := s.Put(bytes.NewReader(padded([]byte("ID3"), 6*mib))); err != nil || !strings.HasSuffix(name, ".mp3") {
		t.Errorf("6 MiB MP3 = %q, %v", name, err)
	}
	if _, err := s.Put(bytes.NewReader(padded([]byte("OggS"), 10*mib+1))); !errors.Is(err, ErrTooLarge) {
		t.Errorf("10 MiB+1 OGG: %v, want ErrTooLarge", err)
	}
	if _, err := s.Put(bytes.NewReader(padded([]byte("OggS"), 10*mib))); err != nil {
		t.Errorf("10 MiB OGG: %v", err)
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			t.Errorf("temp file left behind: %s", e.Name())
		}
	}
}

func TestSniffAudio(t *testing.T) {
	cases := []struct{ ext, head string }{
		{"mp3", "ID3\x04\x00"},
		{"mp3", "\xff\xfb\x90\x00"},
		{"ogg", "OggS\x00\x02"},
		{"wav", "RIFF\x24\x00\x00\x00WAVEfmt "},
		{"m4a", "\x00\x00\x00\x20ftypM4A \x00\x00"},
		{"m4a", "\x00\x00\x00\x20ftypisom\x00\x00"},
		{"m4a", "\x00\x00\x00\x20ftypmp42\x00\x00"},
		{"jpg", "\xff\xd8\xff\xe0"},
		{"gif", "GIF89a"},
		{"webp", string(riffWebp)},
		{"", "\x00\x00\x00\x20ftypheic\x00\x00"},
		{"", "\xff\x1b"},
	}
	for _, c := range cases {
		if got := sniff([]byte(c.head)); got != c.ext {
			t.Errorf("sniff(%q) = %q, want %q", c.head, got, c.ext)
		}
	}
}

func TestSniffSVG(t *testing.T) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><script>1</script></svg>`
	for _, in := range []string{
		svg,
		"\xef\xbb\xbf" + svg,
		`<?xml version="1.0" encoding="UTF-8"?>` + "\n" + svg,
		`<?xml version="1.0" encoding="windows-1251"?>` + svg,
		"<!-- drawn by hand -->\n" + svg,
		`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">` + svg,
		`<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>`,
	} {
		if got := sniff([]byte(in)); got != "svg" {
			t.Errorf("sniff(%.60q) = %q, want svg", in, got)
		}
	}
	for _, in := range []string{
		"<html><body>" + svg + "</body></html>",
		"<html>",
		`<?xml version="1.0"?><note/>`,
		"text",
		"text " + svg,
		strings.Repeat(" ", 8<<10) + svg,
		"<!-- " + strings.Repeat("x", 8<<10) + " -->" + svg,
	} {
		if got := sniff([]byte(in)); got != "" {
			t.Errorf("sniff(%.60q) = %q, want none", in, got)
		}
	}
}

func TestOpenRejectsBadNames(t *testing.T) {
	s, dir := open(t)
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "klats.db"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	missing := hash + ".png"
	for _, name := range []string{"../klats.db", "x.png", strings.ToUpper(hash) + ".png", missing, hash + ".html", hash + ".png/", "", "/etc/passwd", `..\klats.db`} {
		if f, _, err := s.Open(name); !errors.Is(err, ErrNotFound) {
			if f != nil {
				_ = f.Close()
			}
			t.Errorf("Open(%q) = %v, want ErrNotFound", name, err)
		}
	}
}

func TestOpenServesStoredFile(t *testing.T) {
	s, _ := open(t)
	name, err := s.Put(bytes.NewReader(padded([]byte("ID3"), 20)))
	if err != nil {
		t.Fatal(err)
	}
	f, ct, err := s.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if b, _ := io.ReadAll(f); len(b) != 20 || ct != "audio/mpeg" {
		t.Errorf("len %d, content type %q", len(b), ct)
	}
}

func TestOpenContentTypeForEveryExtension(t *testing.T) {
	s, _ := open(t)
	for _, c := range []struct{ head, ext, contentType string }{
		{"\xff\xd8\xff\xe0", "jpg", "image/jpeg"},
		{string(pngHead), "png", "image/png"},
		{"GIF89a", "gif", "image/gif"},
		{string(riffWebp), "webp", "image/webp"},
		{"ID3\x04", "mp3", "audio/mpeg"},
		{"\x00\x00\x00\x20ftypM4A \x00\x00", "m4a", "audio/mp4"},
		{"OggS\x00", "ogg", "audio/ogg"},
		{"RIFF\x24\x00\x00\x00WAVEfmt ", "wav", "audio/wav"},
		{string(svgHead), "svg", "image/svg+xml"},
	} {
		name, err := s.Put(strings.NewReader(c.head))
		if err != nil || !strings.HasSuffix(name, "."+c.ext) {
			t.Fatalf("%s: Put = %q, %v", c.ext, name, err)
		}
		f, ct, err := s.Open(name)
		if err != nil {
			t.Fatalf("%s: Open: %v", c.ext, err)
		}
		_ = f.Close()
		if ct != c.contentType {
			t.Errorf("%s: content type %q, want %q", c.ext, ct, c.contentType)
		}
	}
}
