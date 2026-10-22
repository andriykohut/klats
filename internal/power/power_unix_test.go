//go:build !windows

package power

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// gone reports whether no process pid exists. A killed child that was not
// waited for is a zombie, which still answers signal 0.
func gone(pid int) bool { return syscall.Kill(pid, 0) == syscall.ESRCH }

func TestReleaseReapsTheHelperAndItsChild(t *testing.T) {
	pids := filepath.Join(t.TempDir(), "pids")
	release, err := start([]string{"sh", "-c", "sleep 60 & echo $$ $! >" + pids + "; wait"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(release)
	var helper, child int
	for deadline := time.Now().Add(5 * time.Second); ; {
		b, _ := os.ReadFile(pids)
		if n, _ := fmt.Sscan(string(b), &helper, &child); n == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the helper did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}

	release()
	if !gone(helper) {
		t.Errorf("helper %d is still there after release: not reaped", helper)
	}
	for deadline := time.Now().Add(5 * time.Second); !gone(child); time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("the helper's child %d outlives release", child)
		}
	}
}
