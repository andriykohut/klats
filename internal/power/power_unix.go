//go:build !windows

package power

import (
	"os/exec"
	"sync"
	"syscall"
)

// start runs argv in its own process group and returns a release that
// terminates the whole group and waits for it to exit. A helper such as
// systemd-inhibit runs its payload as a child, and killing only the helper
// would leave the child holding the lock. release is idempotent.
func start(argv []string) (func(), error) {
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return sync.OnceFunc(func() {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		_ = cmd.Wait()
	}), nil
}
