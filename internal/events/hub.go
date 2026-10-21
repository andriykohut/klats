// Package events is the in-process pub/sub hub that feeds the live updates
// pushed to the teacher's and students' browsers over SSE.
package events

import "sync"

// subscriberBuffer is the per-subscriber queue length.
const subscriberBuffer = 16

// Event is a notification on a topic (`teacher`, `device:<token>`).
type Event struct {
	Topic string
	Name  string
	Data  any
}

// Hub fans events out to the subscribers of their topic. It is safe for
// concurrent use.
type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[chan Event]struct{}
}

// New returns an empty Hub.
func New() *Hub {
	return &Hub{subs: map[string]map[chan Event]struct{}{}}
}

// Subscribe returns a channel receiving the events published to topic and a
// function that unsubscribes and closes the channel. The function is
// idempotent.
func (h *Hub) Subscribe(topic string) (<-chan Event, func()) {
	ch := make(chan Event, subscriberBuffer)
	h.mu.Lock()
	if h.subs[topic] == nil {
		h.subs[topic] = map[chan Event]struct{}{}
	}
	h.subs[topic][ch] = struct{}{}
	h.mu.Unlock()

	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if _, ok := h.subs[topic][ch]; !ok {
			return
		}
		delete(h.subs[topic], ch)
		if len(h.subs[topic]) == 0 {
			delete(h.subs, topic)
		}
		close(ch)
	}
}

// Publish delivers e to the subscribers of e.Topic without blocking. When a
// subscriber's buffer is full the event is dropped for that subscriber only.
// Consumers treat events as "something changed" hints and refetch the state,
// so a dropped event is harmless.
func (h *Hub) Publish(e Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs[e.Topic] {
		select {
		case ch <- e:
		default:
		}
	}
}
