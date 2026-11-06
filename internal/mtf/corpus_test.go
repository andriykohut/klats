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

// TestCorpus opens every .mtf file under the directories listed in
// KLATS_MTF_CORPUS into one store, and logs per directory the questions per
// type, the notes per code and the slowest file. Real files hold personal
// data, so they never enter the repository, and failures name files by base
// name only.
func TestCorpus(t *testing.T) {
	dirs := os.Getenv("KLATS_MTF_CORPUS")
	if dirs == "" {
		t.Skip("KLATS_MTF_CORPUS is not set")
	}
	ms, _ := store(t)
	for _, dir := range filepath.SplitList(dirs) {
		var files int
		types, notes := map[string]int{}, map[string]int{}
		var slowest time.Duration
		var slowestName string
		_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				t.Errorf("%s: cannot be listed", filepath.Base(path))
				return nil
			}
			if d.IsDir() || !strings.EqualFold(filepath.Ext(path), ".mtf") {
				return nil
			}
			files++
			// The file is read first so the time is the converter's alone:
			// many corpus files are cloud placeholders, slow to fetch.
			data, err := os.ReadFile(path)
			if err != nil {
				t.Errorf("%s: cannot be read", d.Name())
				return nil
			}
			start := time.Now()
			test, ns, err := mtf.Open(bytes.NewReader(data), ms)
			if took := time.Since(start); took > slowest {
				slowest, slowestName = took, d.Name()
			}
			if err != nil {
				t.Errorf("%s: %v", d.Name(), err)
				return nil
			}
			for _, q := range test.Questions {
				types[q.Type]++
			}
			for _, n := range ns {
				notes[n.Code]++
			}
			return nil
		})
		t.Logf("%s: %d files, questions per type %v, notes per code %v, slowest file %s in %v",
			filepath.Base(dir), files, types, notes, slowestName, slowest)
	}
}
