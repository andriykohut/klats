package lan

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"slices"
	"sync"
	"testing"
	"time"

	"klats/internal/config"
)

func ifc(name string, addrs ...string) Iface {
	i := Iface{Name: name, Up: true}
	for _, a := range addrs {
		i.Addrs = append(i.Addrs, netip.MustParseAddr(a))
	}
	return i
}

func addrs(ss ...string) []netip.Addr {
	var out []netip.Addr
	for _, s := range ss {
		out = append(out, netip.MustParseAddr(s))
	}
	return out
}

func TestCandidatesOrder(t *testing.T) {
	down := ifc("eth1", "192.168.9.9")
	down.Up = false
	loop := ifc("lo", "127.0.0.1", "192.168.7.7")
	loop.Loopback = true
	tests := []struct {
		name string
		in   []Iface
		want []netip.Addr
	}{
		{"range then filtering", []Iface{
			ifc("eth0", "10.0.0.5"), ifc("Wi-Fi", "192.168.1.10"), ifc("eth2", "127.0.0.1", "169.254.3.4", "100.64.0.1", "8.8.8.8", "fe80::1", "172.32.0.1"),
			down, loop,
		}, addrs("192.168.1.10", "10.0.0.5")},
		{"172.16/12 last", []Iface{ifc("a", "172.20.0.2"), ifc("b", "10.1.1.1"), ifc("c", "192.168.0.2")}, addrs("192.168.0.2", "10.1.1.1", "172.20.0.2")},
		{"wired before wireless in one range", []Iface{ifc("wlan0", "192.168.1.5"), ifc("enp3s0", "192.168.1.6"), ifc("Бездротова мережа", "192.168.1.7")}, addrs("192.168.1.6", "192.168.1.5", "192.168.1.7")},
		{"wl prefix only", []Iface{ifc("wlp2s0", "192.168.1.5"), ifc("eth0", "192.168.1.6")}, addrs("192.168.1.6", "192.168.1.5")},
		{"virtual adapters last", []Iface{ifc("VirtualBox Host-Only Network", "192.168.56.1"), ifc("Ethernet", "10.0.0.5")}, addrs("10.0.0.5", "192.168.56.1")},
		{"dedup", []Iface{ifc("eth0", "10.0.0.5"), ifc("eth1", "10.0.0.5")}, addrs("10.0.0.5")},
		{"none", nil, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Candidates(tt.in); !slices.Equal(got, tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestChoose(t *testing.T) {
	c := addrs("192.168.1.10", "10.0.0.5")
	tests := []struct {
		name  string
		cands []netip.Addr
		saved string
		want  string
		ok    bool
	}{
		{"saved present", c, "10.0.0.5", "10.0.0.5", true},
		{"saved gone", c, "10.9.9.9", "192.168.1.10", true},
		{"saved garbage", c, "nope", "192.168.1.10", true},
		{"no saved", c, "", "192.168.1.10", true},
		{"empty", nil, "10.0.0.5", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := Choose(tt.cands, tt.saved)
			if ok != tt.ok || (ok && got.String() != tt.want) {
				t.Fatalf("got %v %v, want %v %v", got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestURLOmitsPort80(t *testing.T) {
	a := netip.MustParseAddr("192.168.1.10")
	if got := URL(a, 80); got != "http://192.168.1.10" {
		t.Fatal(got)
	}
	if got := URL(a, 8080); got != "http://192.168.1.10:8080" {
		t.Fatal(got)
	}
}

func TestPorts(t *testing.T) {
	win, other := ports("windows"), ports("linux")
	if win[0] != 80 || win[1] != 8080 || len(win) != 21 {
		t.Fatalf("windows: %v", win)
	}
	if other[0] != 8080 || other[len(other)-1] != 8099 || len(other) != 20 {
		t.Fatalf("other: %v", other)
	}
}

// freePort returns a port that was free a moment ago.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().(*net.TCPAddr).Port
}

func occupy(t *testing.T, port int) {
	t.Helper()
	l, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.Close() })
}

func TestListenNeverSwitchesSavedPort(t *testing.T) {
	p := freePort(t)
	occupy(t, p)
	s := &config.Settings{Port: p}
	l, err := listen(s, []int{p, freePort(t)})
	if l != nil {
		_ = l.Close()
	}
	var busy ErrPortBusy
	if !errors.As(err, &busy) || busy.Port != p || busy.Err == nil || !errors.Is(err, busy.Err) {
		t.Fatalf("err = %v", err)
	}
	if s.Port != p {
		t.Fatalf("port changed to %d", s.Port)
	}
}

func TestListenSavedPortBinds(t *testing.T) {
	p := freePort(t)
	s := &config.Settings{Port: p}
	l, err := listen(s, []int{freePort(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	if got := l.Addr().(*net.TCPAddr).Port; got != p {
		t.Fatalf("bound %d, want %d", got, p)
	}
}

func TestListenFirstRunFallsBack(t *testing.T) {
	p1, p2 := freePort(t), freePort(t)
	occupy(t, p1)
	s := &config.Settings{}
	l, err := listen(s, []int{p1, p2})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	if s.Port != p2 || l.Addr().(*net.TCPAddr).Port != p2 {
		t.Fatalf("settings port %d, listener %v, want %d", s.Port, l.Addr(), p2)
	}
}

func TestListenFirstRunAllBusy(t *testing.T) {
	p := freePort(t)
	occupy(t, p)
	s := &config.Settings{}
	if _, err := listen(s, []int{p}); err == nil || s.Port != 0 {
		t.Fatalf("err = %v, port = %d", err, s.Port)
	}
}

func TestWatchReportsChange(t *testing.T) {
	var mu sync.Mutex
	cur := addrs("192.168.1.10", "10.0.0.5")
	list := func() []netip.Addr {
		mu.Lock()
		defer mu.Unlock()
		return slices.Clone(cur)
	}
	type change struct{ old, new []netip.Addr }
	got := make(chan change, 4)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		Watch(ctx, time.Millisecond, list, func(o, n []netip.Addr) { got <- change{o, n} })
		close(done)
	}()

	// Reordering and no-ops are not changes.
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	cur = addrs("10.0.0.5", "192.168.1.10")
	mu.Unlock()
	select {
	case c := <-got:
		t.Fatalf("unexpected change %v", c)
	case <-time.After(30 * time.Millisecond):
	}

	mu.Lock()
	cur = addrs("10.0.0.5")
	mu.Unlock()
	select {
	case c := <-got:
		if len(c.old) != 2 || !slices.Equal(c.new, addrs("10.0.0.5")) {
			t.Fatalf("change = %+v", c)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no change reported")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Watch did not return")
	}
}
