package power

import (
	"runtime"
	"sync"
	"syscall"
)

const (
	esContinuous     = 0x80000000
	esSystemRequired = 0x00000001
)

var setThreadExecutionState = syscall.NewLazyDLL("kernel32.dll").NewProc("SetThreadExecutionState")

// Inhibit keeps the computer from idle sleep until release is called. reason
// is not shown on Windows. release is idempotent.
func Inhibit(reason string) (release func(), err error) {
	// The execution state belongs to the calling OS thread, so one locked
	// thread sets it, holds it until release, and clears it.
	set := make(chan error, 1)
	done := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		if r, _, err := setThreadExecutionState.Call(esContinuous | esSystemRequired); r == 0 {
			set <- err
			return
		}
		set <- nil
		<-done
		_, _, _ = setThreadExecutionState.Call(esContinuous)
	}()
	if err := <-set; err != nil {
		return nil, err
	}
	return sync.OnceFunc(func() { close(done) }), nil
}
