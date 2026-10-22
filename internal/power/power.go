// Package power keeps the teacher's computer from sleeping while a sitting
// runs, with each OS's own mechanism: a power request on Windows, caffeinate
// on macOS and systemd-inhibit on Linux.
package power

import "strconv"

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
