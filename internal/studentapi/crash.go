package studentapi

import (
	"log/slog"
	"net/http"

	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/wire"
)

// maxCrashBytes caps a crash report. A real one is a few KiB, while anyone on
// the LAN can post them and the log rotates only at startup, so the cap times
// deviceLimit bounds how fast reports can grow the log.
const maxCrashBytes = 16 << 10

// crash writes a crash report from the student app to the log, at most
// deviceLimit reports a rateWindow from all students together, and replies
// 204 to any well-formed report, whether or not it was written.
func (a *api) crash(w http.ResponseWriter, r *http.Request) {
	var c wire.ClientError
	if !httpx.Decode(w, r, &c, maxCrashBytes) {
		return
	}
	// One key shared by every student, so a flood of reports cannot fill the disk.
	if a.crashes.allow("all", "all") {
		slog.Error("student app crashed", "ip", limitKey(r.RemoteAddr), "browser", r.UserAgent(), "page", c.Page, "message", c.Message, "stack", c.Stack)
	}
	w.WriteHeader(http.StatusNoContent)
}
