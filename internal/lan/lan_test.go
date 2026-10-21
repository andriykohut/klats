package lan

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"slices"
	"strings"
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
		{"VirtualBox host-only after ethernet", []Iface{ifc("VirtualBox Host-Only Network", "192.168.56.1"), ifc("Ethernet", "10.0.0.5")}, addrs("10.0.0.5", "192.168.56.1")},
		{"same rank keeps input order", []Iface{ifc("eth0", "10.0.0.9"), ifc("eth1", "10.0.0.2"), ifc("eth2", "10.0.0.5")}, addrs("10.0.0.9", "10.0.0.2", "10.0.0.5")},
		{"dedup across interfaces", []Iface{ifc("eth0", "10.0.0.5"), ifc("eth1", "10.0.0.5")}, addrs("10.0.0.5")},
		{"dedup keeps the best rank", []Iface{ifc("docker0", "192.168.5.5"), ifc("Ethernet", "192.168.5.5", "10.0.0.1")}, addrs("192.168.5.5", "10.0.0.1")},
		{"IPv4-mapped address is unmapped", []Iface{ifc("eth0", "::ffff:192.168.1.5")}, addrs("192.168.1.5")},
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

// The names are the ones Windows, Linux and macOS give virtual adapters. The
// "only" names match exactly one hint so that dropping any hint fails a case.
func TestCandidatesVirtualAdaptersLast(t *testing.T) {
	names := []string{
		"vEthernet (WSL)", "VMware Network Adapter VMnet8", "docker0", "br-1a2b", "veth12", "Tailscale",
		"ZeroTier One", "utun3", "Hyper-V Virtual Ethernet Adapter",
		"Microsoft Virtual Adapter", "VMware Adapter", "vmnet1", "vboxnet0", "Hyper-V Switch", "WSL", "vEthernet (Default Switch)",
	}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			got := Candidates([]Iface{ifc(name, "192.168.5.5"), ifc("Ethernet", "10.0.0.5")})
			if want := addrs("10.0.0.5", "192.168.5.5"); !slices.Equal(got, want) {
				t.Fatalf("got %v, want %v", got, want)
			}
		})
	}
}

func TestCandidatesWirelessAfterWired(t *testing.T) {
	names := []string{"Wi-Fi", "Intel WiFi", "nic-wlan0", "wlp2s0", "Wireless Network", "Бездротова мережа", "Беспроводная сеть"}
	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			got := Candidates([]Iface{ifc(name, "192.168.1.5"), ifc("Ethernet", "192.168.1.6")})
			if want := addrs("192.168.1.6", "192.168.1.5"); !slices.Equal(got, want) {
				t.Fatalf("got %v, want %v", got, want)
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
	if got := describe(win); got != "80, 8080–8099" {
		t.Fatal(got)
	}
	if got := describe(other); got != "8080–8099" {
		t.Fatal(got)
	}
}

// freePorts returns n distinct ports that were free a moment ago. All probes
// stay open until every port is chosen, so the ports cannot collide.
func freePorts(t *testing.T, n int) []int {
	t.Helper()
	var out []int
	for range n {
		l, err := net.Listen("tcp", ":0")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = l.Close() }()
		out = append(out, l.Addr().(*net.TCPAddr).Port)
	}
	return out
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
	ps := freePorts(t, 2)
	occupy(t, ps[0])
	s := &config.Settings{Port: ps[0]}
	l, err := listen(s, ps)
	if l != nil {
		_ = l.Close()
	}
	var busy ErrPortBusy
	if !errors.As(err, &busy) || busy.Port != ps[0] || busy.Err == nil || !errors.Is(err, busy.Err) {
		t.Fatalf("err = %v", err)
	}
	if s.Port != ps[0] {
		t.Fatalf("port changed to %d", s.Port)
	}
}

func TestListenSavedPortOutOfRange(t *testing.T) {
	for _, p := range []int{-1, 65536, 70000} {
		l, err := listen(&config.Settings{Port: p}, freePorts(t, 1))
		if l != nil {
			_ = l.Close()
		}
		var busy ErrPortBusy
		if err == nil || errors.As(err, &busy) {
			t.Fatalf("port %d: err = %v", p, err)
		}
	}
}

func TestListenSavedPortBinds(t *testing.T) {
	ps := freePorts(t, 2)
	s := &config.Settings{Port: ps[0]}
	l, err := listen(s, ps[1:])
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	if got := l.Addr().(*net.TCPAddr).Port; got != ps[0] {
		t.Fatalf("bound %d, want %d", got, ps[0])
	}
}

func TestListenFirstRunFallsBack(t *testing.T) {
	ps := freePorts(t, 2)
	occupy(t, ps[0])
	s := &config.Settings{}
	l, err := listen(s, ps)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	if s.Port != ps[1] || l.Addr().(*net.TCPAddr).Port != ps[1] {
		t.Fatalf("settings port %d, listener %v, want %d", s.Port, l.Addr(), ps[1])
	}
}

func TestListenFirstRunAllBusy(t *testing.T) {
	ps := freePorts(t, 1)
	occupy(t, ps[0])
	s := &config.Settings{}
	_, err := listen(s, ps)
	var opErr *net.OpError
	if err == nil || s.Port != 0 || !errors.As(err, &opErr) {
		t.Fatalf("err = %v, port = %d", err, s.Port)
	}
	if want := fmt.Sprintf("no free port in %d:", ps[0]); !strings.HasPrefix(err.Error(), want) {
		t.Fatalf("err = %v", err)
	}
}

func TestWatchReportsChange(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	lists := make(chan []netip.Addr)
	list := func() []netip.Addr {
		select {
		case v := <-lists:
			return v
		case <-ctx.Done():
			return nil
		}
	}
	feed := func(v []netip.Addr) {
		t.Helper()
		select {
		case lists <- v:
		case <-time.After(5 * time.Second):
			t.Fatal("Watch did not poll")
		}
	}
	type change struct{ old, new []netip.Addr }
	got := make(chan change, 4)
	done := make(chan struct{})
	go func() {
		Watch(ctx, time.Millisecond, list, func(o, n []netip.Addr) { got <- change{o, n} })
		close(done)
	}()

	feed(addrs("192.168.1.10", "10.0.0.5")) // baseline
	feed(addrs("10.0.0.5", "192.168.1.10")) // reorder: not a change
	feed(addrs("10.0.0.5"))                 // the first onChange must be this one

	select {
	case c := <-got:
		if !slices.Equal(c.old, addrs("192.168.1.10", "10.0.0.5")) || !slices.Equal(c.new, addrs("10.0.0.5")) {
			t.Fatalf("change = %+v", c)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no change reported")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Watch did not return")
	}
	select {
	case c := <-got:
		t.Fatalf("change after the first: %+v", c)
	default:
	}
}
