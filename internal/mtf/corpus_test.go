package mtf_test

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"klats/internal/mtf"
)

// TestCorpus reads every .mtf file under the directories listed in
// KLATS_MTF_CORPUS. Real files hold personal data, so they never enter the
// repository, and failures name files by base name only.
func TestCorpus(t *testing.T) {
	dirs := os.Getenv("KLATS_MTF_CORPUS")
	if dirs == "" {
		t.Skip("KLATS_MTF_CORPUS is not set")
	}
	var files, entries int
	types := map[int]int{}
	var slowest time.Duration
	for _, dir := range filepath.SplitList(dirs) {
		_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				t.Errorf("%s: cannot be listed", filepath.Base(path))
				return nil
			}
			if d.IsDir() || !strings.EqualFold(filepath.Ext(path), ".mtf") {
				return nil
			}
			files++
			// The file is read first so the time is the reader's alone: many
			// corpus files are cloud placeholders, slow to fetch.
			data, err := os.ReadFile(path)
			if err != nil {
				t.Errorf("%s: cannot be read", d.Name())
				return nil
			}
			start := time.Now()
			f, err := mtf.Read(bytes.NewReader(data), func(string, []byte) error {
				entries++
				return nil
			})
			slowest = max(slowest, time.Since(start))
			if err != nil {
				t.Errorf("%s: %v", d.Name(), err)
				return nil
			}
			for _, q := range f.Questions {
				types[q.Type]++
			}
			return nil
		})
	}
	t.Logf("%d files, questions per type %v, %d media entries, slowest file %v", files, types, entries, slowest)
}
