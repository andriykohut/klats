package teacherapi

import (
	"log/slog"
	"net/http"

	"github.com/andriykohut/klats/internal/httpx"
	"github.com/andriykohut/klats/internal/wire"
)

// maxCrashBytes caps a crash report: room for a long stack trace, while a
// runaway report cannot bloat the log.
const maxCrashBytes = 64 << 10

// crash writes a crash report from the teacher app to the log.
func (a *api) crash(w http.ResponseWriter, r *http.Request) {
	var c wire.ClientError
	if !httpx.Decode(w, r, &c, maxCrashBytes) {
		return
	}
	slog.Error("teacher app crashed", "page", c.Page, "message", c.Message, "stack", c.Stack)
	w.WriteHeader(http.StatusNoContent)
}
