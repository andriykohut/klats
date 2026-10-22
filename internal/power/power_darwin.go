package power

import "os"

// Inhibit keeps the computer from idle sleep until release is called, by
// running caffeinate, which also exits on its own when this process does.
// reason is not shown on macOS. release is idempotent.
func Inhibit(reason string) (release func(), err error) {
	return start(command("darwin", os.Getpid(), reason))
}
