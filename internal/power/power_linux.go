package power

import (
	"log/slog"
	"os"
	"os/exec"
)

// Inhibit keeps the computer from idle sleep and suspend until release is
// called or this process exits, by holding a systemd-inhibit lock that names
// reason. Without systemd-inhibit it logs a warning and returns a no-op
// release. release is idempotent.
func Inhibit(reason string) (release func(), err error) {
	argv := command("linux", os.Getpid(), reason)
	if _, err := exec.LookPath(argv[0]); err != nil {
		slog.Warn("power: systemd-inhibit not found; the computer may sleep during a test", "err", err)
		return func() {}, nil
	}
	return start(argv)
}
