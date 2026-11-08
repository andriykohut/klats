package studentapi

import (
	"sync"
	"time"
)

const (
	rateWindow  = time.Minute
	deviceLimit = 10  // joins and picks per device token, and crash lines from all students together, per window
	ipLimit     = 300 // joins and picks per client IP per window
)

// limiter counts join and pick attempts in sliding windows, per device token
// and per client IP. The crash limiter counts every report under one shared
// key (see crash.go), so deviceLimit also caps the crash lines all students
// log together. Counts live in memory only.
type limiter struct {
	now func() time.Time

	mu    sync.Mutex
	hits  map[string][]time.Time // "d:<token>" or "ip:<ip>" → attempt times, oldest first
	swept time.Time
}

func newLimiter(now func() time.Time) *limiter {
	return &limiter{now: now, hits: map[string][]time.Time{}}
}

// allow records an attempt by the device from ip and reports whether both
// windows have room. A refused attempt is not recorded, so a flood of refused
// attempts neither extends its own lockout nor creates keys.
func (l *limiter) allow(ip, device string) bool {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(now)
	d, i := "d:"+device, "ip:"+ip
	if l.count(d, now) >= deviceLimit || l.count(i, now) >= ipLimit {
		return false
	}
	l.hits[d] = append(l.hits[d], now)
	l.hits[i] = append(l.hits[i], now)
	return true
}

// count drops the expired attempts of key and returns how many remain.
func (l *limiter) count(key string, now time.Time) int {
	h := l.hits[key]
	n := 0
	for n < len(h) && now.Sub(h[n]) >= rateWindow {
		n++
	}
	if n > 0 {
		l.hits[key] = h[n:]
	}
	return len(h) - n
}

// sweep forgets keys with no attempt in the window, at most once per window,
// so the map does not grow with every device that ever joined.
func (l *limiter) sweep(now time.Time) {
	if now.Sub(l.swept) < rateWindow {
		return
	}
	l.swept = now
	for k, h := range l.hits {
		if len(h) == 0 || now.Sub(h[len(h)-1]) >= rateWindow {
			delete(l.hits, k)
		}
	}
}
