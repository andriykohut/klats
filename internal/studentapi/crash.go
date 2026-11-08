package studentapi

import (
	"log/slog"
	"net/http"

	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/wire"
)

// maxCrashBytes caps a crash report. A real one is a few KiB, while anyone on
// the LAN can post them and the log rotates only at startup. The log quotes
// each control byte such as DEL as \x7f, four bytes, so a line at the cap logs
// up to about 65 KiB with the clipped User-Agent, and deviceLimit lines a
// minute grow the log by at most about 38 MiB an hour.
const maxCrashBytes = 16 << 10

// maxUserAgentBytes clips the logged User-Agent: the server accepts headers
// up to 1 MiB.
const maxUserAgentBytes = 256

// crash writes a crash report from the student app to the log, at most
// deviceLimit reports a rateWindow from all students together, and replies
// 204 to any well-formed report, whether or not it was written.
func (a *api) crash(w http.ResponseWriter, r *http.Request) {
	var c wire.ClientError
	if !httpx.Decode(w, r, &c, maxCrashBytes) {
		return
	}
	// One key shared by every student, so a flood of reports cannot fill the disk.
	// shortcut: one shared key, so a flood from one computer crowds out other students' real reports; key by IP if that matters.
	if a.crashes.allow("all", "all") {
		ua := r.UserAgent()
		slog.Error("student app crashed", "ip", limitKey(r.RemoteAddr), "browser", ua[:min(len(ua), maxUserAgentBytes)], "page", c.Page, "message", c.Message, "stack", c.Stack)
	}
	w.WriteHeader(http.StatusNoContent)
}
