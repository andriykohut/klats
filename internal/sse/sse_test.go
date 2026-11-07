package sse

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/andriykohut/klats/internal/events"
)

func TestStreamWritesEventAndKeepAlive(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	r := httptest.NewRequest("GET", "/api/events", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	ch := make(chan events.Event, 1)
	ch <- events.Event{Topic: "teacher", Name: "live", Data: map[string]int{"n": 1}}

	if err := Stream(w, r, ch, 20*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	body := w.Body.String()
	if !strings.Contains(body, "event: live\ndata: {\"n\":1}\n\n") {
		t.Fatalf("missing event in %q", body)
	}
	if !strings.Contains(body, ": ka\n\n") {
		t.Fatalf("missing keep-alive in %q", body)
	}
	h := w.Header()
	if h.Get("Content-Type") != "text/event-stream" || h.Get("Cache-Control") != "no-cache" || h.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("headers %v", h)
	}
}

func TestStreamReturnsNilWhenChannelClosed(t *testing.T) {
	ch := make(chan events.Event)
	close(ch)
	r := httptest.NewRequest("GET", "/", nil)
	if err := Stream(httptest.NewRecorder(), r, ch, time.Minute); err != nil {
		t.Fatal(err)
	}
}

func TestStreamMarshalErrorEndsStream(t *testing.T) {
	ch := make(chan events.Event, 1)
	ch <- events.Event{Name: "x", Data: make(chan int)}
	r := httptest.NewRequest("GET", "/", nil)
	if err := Stream(httptest.NewRecorder(), r, ch, time.Minute); err == nil {
		t.Fatal("want marshal error")
	}
}

// noFlush hides the recorder's Flush method.
type noFlush struct{ http.ResponseWriter }

func TestStreamWithoutFlusherFailsBeforeWriting(t *testing.T) {
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/", nil)
	err := Stream(noFlush{rec}, r, make(chan events.Event), time.Minute)
	if !errors.Is(err, http.ErrNotSupported) {
		t.Fatalf("err = %v", err)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("wrote %q", rec.Body.String())
	}
}

func TestStreamRejectsNameWithLineBreak(t *testing.T) {
	for _, name := range []string{"a\nb", "a\rb", ""} {
		ch := make(chan events.Event, 1)
		ch <- events.Event{Name: name, Data: 1}
		rec := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/", nil)
		if err := Stream(rec, r, ch, time.Minute); err == nil {
			t.Fatalf("name %q: want error", name)
		}
		if strings.Contains(rec.Body.String(), "data:") {
			t.Fatalf("name %q: body %q", name, rec.Body.String())
		}
	}
}
