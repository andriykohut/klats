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

func TestSlowSubscriberDoesNotBlockPublish(t *testing.T) {
	h := New()
	_, unsub := h.Subscribe("teacher")
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

func TestSubscribeToSeveralTopics(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe("device:x", "names:s")
	h.Publish(Event{Topic: "device:x", Name: "status"})
	h.Publish(Event{Topic: "names:s", Name: "taken"})
	if a, b := <-ch, <-ch; a.Name != "status" || b.Name != "taken" {
		t.Fatalf("got %q then %q", a.Name, b.Name)
	}
	unsub()
	unsub() // idempotent
	if _, ok := <-ch; ok {
		t.Fatal("channel not closed")
	}
	// A topic still holding the closed channel would panic on this send.
	h.Publish(Event{Topic: "device:x", Name: "status"})
	h.Publish(Event{Topic: "names:s", Name: "taken"})
}
