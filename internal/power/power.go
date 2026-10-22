// Package power keeps the teacher's computer from sleeping while a sitting
// runs, with each OS's own mechanism: a power request on Windows, caffeinate
// on macOS and systemd-inhibit on Linux.
package power

import (
	"os/exec"
	"strconv"
	"sync"
)

// command returns the helper process that holds the inhibition on goos for
// the process pid, or nil when goos needs none. Both helpers exit when pid
// does, so a crash does not leave the computer kept awake.
func command(goos string, pid int, reason string) []string {
	switch goos {
	case "darwin":
		return []string{"caffeinate", "-i", "-w", strconv.Itoa(pid)}
	case "linux":
		return []string{"systemd-inhibit", "--what=idle:sleep", "--who=Klats", "--why=" + reason, "tail", "--pid=" + strconv.Itoa(pid), "-f", "/dev/null"}
	}
	return nil
}

// start runs argv and returns a release that kills it and waits for it to
// exit. release is idempotent.
func start(argv []string) (func(), error) {
	cmd := exec.Command(argv[0], argv[1:]...)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return sync.OnceFunc(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}), nil
}
