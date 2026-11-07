package update

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewer(t *testing.T) {
	cases := []struct {
		current, latest string
		want            bool
	}{
		{"1.0.9", "1.0.10", true},
		{"1.0.10", "1.0.9", false},
		{"1.0.0", "1.0.0", false},
		{"1.1.0-rc.1", "1.1.0", true},
		{"1.1.0-rc.1", "1.0.0", false},
		{"dev", "9.9.9", false},
	}
	for _, c := range cases {
		if got := Newer(c.current, c.latest); got != c.want {
			t.Errorf("Newer(%q, %q) = %v, want %v", c.current, c.latest, got, c.want)
		}
	}
}

// release serves a fixed reply and records the Accept header it got.
func release(t *testing.T, status int, body string) (*httptest.Server, *atomic.Value) {
	t.Helper()
	accept := &atomic.Value{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		accept.Store(r.Header.Get("Accept"))
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, accept
}

func TestLatest(t *testing.T) {
	srv, accept := release(t, 200, `{"tag_name":"v1.2.0","html_url":"https://x/r"}`)
	got, err := Latest(context.Background(), srv.Client(), srv.URL)
	if err != nil || got != (Release{"1.2.0", "https://x/r"}) {
		t.Errorf("Latest = %+v, %v", got, err)
	}
	if a := accept.Load(); a != "application/vnd.github+json" {
		t.Errorf("Accept = %v", a)
	}

	bad := map[string]struct {
		status int
		body   string
	}{
		"403":       {403, `{"message":"rate limited"}`},
		"500":       {500, ``},
		"HTML":      {200, `<html>GitHub</html>`},
		"nightly":   {200, `{"tag_name":"nightly","html_url":"https://x/r"}`},
		"not https": {200, `{"tag_name":"v1.2.0","html_url":"file:///etc/passwd"}`},
	}
	for name, c := range bad {
		srv, _ := release(t, c.status, c.body)
		if got, err := Latest(context.Background(), srv.Client(), srv.URL); err == nil {
			t.Errorf("%s: Latest = %+v, want an error", name, got)
		}
	}
}

// stub is a releases endpoint whose first fails requests answer 500 and the
// rest the tag.
type stub struct {
	tag   string
	fails int
	mu    sync.Mutex
	times []time.Time // when each request came
}

func (s *stub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.times = append(s.times, time.Now())
	n := len(s.times)
	s.mu.Unlock()
	if n <= s.fails {
		w.WriteHeader(500)
		return
	}
	_, _ = w.Write([]byte(`{"tag_name":"` + s.tag + `","html_url":"https://x/r"}`))
}

func (s *stub) requests() []time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.times)
}

// watch runs Watch against s as version 1.0.0, looking every 5ms, until the
// test ends, and returns the releases it finds.
func watch(t *testing.T, s *stub, every time.Duration, allowed func() bool) <-chan Release {
	t.Helper()
	srv := httptest.NewServer(s)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	t.Cleanup(func() {
		cancel()
		<-done
		srv.Close()
	})
	found := make(chan Release, 100)
	go func() {
		defer close(done)
		Watch(ctx, Options{
			URL: srv.URL, Client: srv.Client(), Every: every, Retry: 5 * time.Millisecond,
			Current: "1.0.0", Allowed: allowed, Found: func(r Release) { found <- r },
		})
	}()
	return found
}

func wantFound(t *testing.T, found <-chan Release) Release {
	t.Helper()
	select {
	case r := <-found:
		return r
	case <-time.After(2 * time.Second):
		t.Fatal("Found was not called within 2 s")
		return Release{}
	}
}

func always() bool { return true }

func TestWatchHoldsAndRetries(t *testing.T) {
	t.Run("holds while not allowed", func(t *testing.T) {
		s := &stub{tag: "v1.1.0"}
		var allowed atomic.Bool
		found := watch(t, s, time.Hour, allowed.Load)
		time.Sleep(40 * time.Millisecond)
		if n := len(s.requests()); n != 0 {
			t.Fatalf("%d requests while not allowed, want 0", n)
		}
		allowed.Store(true)
		if r := wantFound(t, found); r != (Release{"1.1.0", "https://x/r"}) {
			t.Errorf("found %+v", r)
		}
		time.Sleep(20 * time.Millisecond)
		if n := len(s.requests()); n != 1 {
			t.Errorf("%d requests, want 1", n)
		}
	})

	t.Run("retries a failing server", func(t *testing.T) {
		s := &stub{tag: "v1.1.0", fails: 2}
		wantFound(t, watch(t, s, time.Hour, always))
		if n := len(s.requests()); n != 3 {
			t.Errorf("%d requests, want 3", n)
		}
	})

	t.Run("checks again once Every has passed", func(t *testing.T) {
		s := &stub{tag: "v1.1.0"}
		found := watch(t, s, 50*time.Millisecond, always)
		wantFound(t, found)
		wantFound(t, found)
		if r := s.requests(); r[1].Sub(r[0]) < 50*time.Millisecond {
			t.Errorf("checked again after %v, want 50ms", r[1].Sub(r[0]))
		}
	})

	t.Run("ignores an older release", func(t *testing.T) {
		s := &stub{tag: "v0.9.0"}
		found := watch(t, s, 50*time.Millisecond, always)
		for deadline := time.Now().Add(2 * time.Second); len(s.requests()) < 2; time.Sleep(5 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatal("no second check within 2 s")
			}
		}
		select {
		case r := <-found:
			t.Errorf("found %+v, older than 1.0.0", r)
		default:
		}
	})
}
