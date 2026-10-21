package events

import (
	"testing"
	"time"
)

func TestPublishReachesOnlyTopic(t *testing.T) {
	h := New()
	a, unsubA := h.Subscribe("teacher")
	defer unsubA()
	b, unsubB := h.Subscribe("device:x")
	defer unsubB()

	h.Publish(Event{Topic: "teacher", Name: "live", Data: 1})

	select {
	case e := <-a:
		if e.Name != "live" {
			t.Fatalf("got %+v", e)
		}
	case <-time.After(time.Second):
		t.Fatal("teacher subscriber got nothing")
	}
	select {
	case e := <-b:
		t.Fatalf("other topic received %+v", e)
	default:
	}
}

func TestUnsubscribeClosesChannel(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe("teacher")
	unsub()
	unsub() // idempotent

	if _, ok := <-ch; ok {
		t.Fatal("channel not closed")
	}
	h.Publish(Event{Topic: "teacher", Name: "live"}) // must not panic on a closed subscriber
}

func TestSlowSubscriberDoesNotBlockPublish(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe("teacher")
	defer unsub()

	done := make(chan struct{})
	go func() {
		for i := range 100 {
			h.Publish(Event{Topic: "teacher", Name: "live", Data: i})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Publish blocked on a slow subscriber")
	}
	if got := len(ch); got != 16 {
		t.Fatalf("buffered %d events, want 16", got)
	}
}

func TestConcurrentUse(t *testing.T) {
	h := New()
	done := make(chan struct{})
	for range 8 {
		go func() {
			defer func() { done <- struct{}{} }()
			for range 200 {
				_, unsub := h.Subscribe("t")
				h.Publish(Event{Topic: "t", Name: "n"})
				unsub()
			}
		}()
	}
	for range 8 {
		<-done
	}
}

func TestSubscribersCountsOpenSubscriptions(t *testing.T) {
	h := New()
	if n := h.Subscribers("t"); n != 0 {
		t.Fatalf("empty hub = %d", n)
	}
	_, unsubA := h.Subscribe("t")
	_, unsubB := h.Subscribe("t")
	if n := h.Subscribers("t"); n != 2 {
		t.Errorf("two subscribed = %d", n)
	}
	unsubA()
	unsubB()
	if n := h.Subscribers("t"); n != 0 {
		t.Errorf("after unsubscribing = %d", n)
	}
}
