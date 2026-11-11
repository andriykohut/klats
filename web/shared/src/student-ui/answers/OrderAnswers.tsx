import { useEffect, useRef } from "react";
import { Button } from "react-aria-components/Button";
import { GridList, GridListItem } from "react-aria-components/GridList";
import { useDragAndDrop } from "react-aria-components/useDragAndDrop";
import { m } from "../../paraglide/messages.js";
import type { AnswerProps } from "./AnswerArea";
import { CARD_TYPE, CardFace } from "./CardBoard";
import { nameOf } from "./cards";
import "./cards.css";

/**
 * An ordering question: one list of cards the student puts in order by
 * dragging, by React Aria's keyboard dragging (the right arrow from a card to
 * its drag handle, Enter to start, the down and up arrows to a gap, Enter to
 * drop), or with the ↑ and ↓ buttons of each row, which the right arrow also
 * reaches. The list starts in the order the server sent, which is never the
 * right one. The answer's `items` hold every card id in the student's order;
 * there is none until the first move, so an untouched question stays open.
 * After a button moves a row, focus returns to a button of the same row.
 */
export function OrderAnswers({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const cards = new Map(question.options.map((o, i) => [o.id, { o, i }]));
  const ids = answer?.items ?? question.options.map((o) => o.id);
  const live = !readOnly && !!onChange;
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ id: string; dir: "up" | "down" } | null>(null);

  const commit = (next: string[]) => onChange?.({ items: next });
  const shift = (id: string, by: -1 | 1) => {
    const next = ids.filter((x) => x !== id);
    next.splice(ids.indexOf(id) + by, 0, id);
    refocus.current = { id, dir: by < 0 ? "up" : "down" };
    commit(next);
  };

  // React Aria renders a collection one frame after its items change, so the
  // moved row is found on the next one. At the end of the list its button is
  // off, and the other one takes focus.
  useEffect(() => {
    const f = refocus.current;
    if (!f) return;
    refocus.current = null;
    requestAnimationFrame(() => {
      const row = root.current?.querySelector(
        `[data-card="${CSS.escape(f.id)}"]`,
      );
      const buttons = [
        ...(row?.querySelectorAll<HTMLElement>(".k-order-move") ?? []),
      ];
      const [want, other] = f.dir === "up" ? buttons : buttons.reverse();
      (want?.hasAttribute("disabled") ? other : want)?.focus();
    });
  }, [ids.join()]);

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ [CARD_TYPE]: String(k) })),
    acceptedDragTypes: [CARD_TYPE],
    onReorder(e) {
      const moved = ids.filter((id) => e.keys.has(id));
      const rest = ids.filter((id) => !e.keys.has(id));
      const at =
        rest.indexOf(String(e.target.key)) +
        (e.target.dropPosition === "after" ? 1 : 0);
      commit([...rest.slice(0, at), ...moved, ...rest.slice(at)]);
    },
  });

  return (
    <div ref={root}>
      <GridList
        className="k-order"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        selectionMode="none"
        dragAndDropHooks={live ? dragAndDropHooks : undefined}
      >
        {ids.map((id, i) => {
          const item = cards.get(id);
          if (!item) return null;
          const name = nameOf(
            item.o.content,
            m.card_label({ number: item.i + 1 }),
          );
          return (
            <GridListItem
              key={id}
              id={id}
              className="k-card k-order-row"
              textValue={name}
              aria-label={name}
              data-card={id}
              data-more-item
            >
              {live && (
                <Button slot="drag" className="k-grip">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
                  </svg>
                </Button>
              )}
              <span className="k-order-no" aria-hidden="true">
                {i + 1}
              </span>
              <span className="k-order-text">
                <CardFace card={item.o} />
              </span>
              {live && (
                <>
                  <Button
                    className="k-order-move"
                    aria-label={m.order_up({ item: name })}
                    isDisabled={i === 0}
                    onPress={() => shift(id, -1)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 14.5l6-6 6 6" />
                    </svg>
                  </Button>
                  <Button
                    className="k-order-move"
                    aria-label={m.order_down({ item: name })}
                    isDisabled={i === ids.length - 1}
                    onPress={() => shift(id, 1)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 9.5l6 6 6-6" />
                    </svg>
                  </Button>
                </>
              )}
            </GridListItem>
          );
        })}
      </GridList>
    </div>
  );
}
