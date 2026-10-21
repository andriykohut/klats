// Package sse writes Server-Sent Events responses from an events.Hub
// subscription.
package sse

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"klats/internal/events"
)

// Stream writes the events received on ch to w as `event: <Name>` and
// `data: <json>` frames, and a `: ka` comment every keepAlive so idle
// connections stay open. It returns nil when the request context is done or ch
// is closed, an error if w cannot flush (before anything is written) or an
// event's Data cannot be marshalled to JSON, and the write error if the
// client connection fails.
func Stream(w http.ResponseWriter, r *http.Request, ch <-chan events.Event, keepAlive time.Duration) error {
	rc := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	if err := rc.Flush(); err != nil {
		return fmt.Errorf("sse: response writer cannot flush: %w", err)
	}

	tick := time.NewTicker(keepAlive)
	defer tick.Stop()
	for {
		var frame string
		select {
		case <-r.Context().Done():
			return nil
		case e, ok := <-ch:
			if !ok {
				return nil
			}
			data, err := json.Marshal(e.Data)
			if err != nil {
				return fmt.Errorf("sse: marshal %q data: %w", e.Name, err)
			}
			frame = fmt.Sprintf("event: %s\ndata: %s\n\n", e.Name, data)
		case <-tick.C:
			frame = ": ka\n\n"
		}
		if _, err := fmt.Fprint(w, frame); err != nil {
			return err
		}
		if err := rc.Flush(); err != nil {
			return err
		}
	}
}
