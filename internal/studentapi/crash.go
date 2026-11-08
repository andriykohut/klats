package studentapi

import (
	"log/slog"
	"net/http"

	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/wire"
)

// maxCrashBytes caps a crash report: room for a long stack trace, while a
// runaway report cannot bloat the log.
const maxCrashBytes = 64 << 10

// crash writes a crash report from the student app to the log, at most
// deviceLimit reports a rateWindow from all students together, and replies
// 204 whether or not it was written.
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
