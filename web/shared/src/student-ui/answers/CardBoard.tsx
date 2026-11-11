import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "react-aria-components/Button";
import { GridList, GridListItem } from "react-aria-components/GridList";
import { useDragAndDrop } from "react-aria-components/useDragAndDrop";
import { VisuallyHidden } from "react-aria-components/VisuallyHidden";
import type { Image } from "../../generated/testfmt";
import { m } from "../../paraglide/messages.js";
import { MediaImage, type RichDoc, RichView } from "../../rich/RichView";
import { nameOf, place } from "./cards";
import "./cards.css";

/** The drag type that marks a card, so that nothing else can be dropped on a list. */
export const CARD_TYPE = "application/x-klats-card";

/** A card the student moves: an option or a target, with the text or picture it shows. */
export interface Card {
  id: string;
  content: RichDoc;
  image?: Image;
}

/** A place that holds `capacity` cards. `name` is what screen readers call it. */
export interface Slot {
  id: string;
  name: string;
  capacity: number;
}

/** A card's picture, if it has one, above its text. */
export function CardFace({ card }: { card: Card }) {
  return (
    <span className="k-card-face">
      {card.image && (
        <MediaImage
          className="k-card-img"
          src={card.image.src}
          w={card.image.w}
          h={card.image.h}
        />
      )}
      <RichView doc={card.content} />
    </span>
  );
}

/**
 * A tray of cards and places to put them, for matching, grouping and the word
 * bank. `placed` maps each placed card's id to its slot's id, and a card
 * missing from it is in the tray. `onChange` gets the whole new map.
 *
 * The tray and every slot are React Aria grid lists without selection, so a
 * card moves three ways: dragged with the mouse, dragged by the keyboard
 * (Enter on the card's drag handle starts, Tab goes to a place, Enter drops),
 * or picked and then put down. A click, a tap, Enter or Space picks a card, or
 * unpicks it; while one is picked, each slot (and the tray, if the picked card
 * is placed) has an overlay button that puts it there. A keyboard pick moves
 * focus to the first slot with room, and the card put down there is followed
 * by focus on the next card in the tray. A slot that is full sends its card
 * back to the tray (see {@link place}). Escape unpicks. A hidden live region
 * says which card is picked and where one was put.
 *
 * The caller lays out the slots: `children` gets a function that draws the
 * slot with a given id, and returns the markup around them.
 */
export function CardBoard({
  cards,
  slots,
  placed,
  onChange,
  readOnly,
  children,
}: {
  cards: Card[];
  slots: Slot[];
  placed: Record<string, string>;
  onChange?: (placed: Record<string, string>) => void;
  readOnly?: boolean;
  children: (slot: (id: string) => ReactNode) => ReactNode;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  // Set by Enter on a card, which React Aria turns into an action on key up.
  const enterPending = useRef(false);
  // Set when a keyboard pick should move focus to a slot.
  const focusSlot = useRef(false);
  const capacity = useMemo(
    () => Object.fromEntries(slots.map((s) => [s.id, s.capacity])),
    [slots],
  );
  const live = !readOnly && !!onChange;
  const nameOfCard = (id: string) => {
    const i = cards.findIndex((c) => c.id === id);
    return nameOf(cards[i]?.content, m.card_label({ number: i + 1 }));
  };
  const pick = (card: string | null) => {
    setPicked(card);
    setSaid(card ? m.card_picked({ card: nameOfCard(card) }) : "");
  };
  const move = (card: string, slot: string | null, then?: string) => {
    refocus.current = then ?? card;
    setPicked(null);
    const to = slots.find((s) => s.id === slot)?.name ?? m.cards_tray();
    setSaid(m.card_placed({ card: nameOfCard(card), slot: to }));
    onChange?.(place(placed, card, slot, capacity));
  };
  // A drag moves its card when it ends, not when the drop lands: a card that
  // leaves its list during the drop is detached before the browser's dragend,
  // and React Aria's drag state would never clear.
  const dragged = useRef<{ card: string; slot?: string | null } | null>(null);
  const drag: Drag = {
    start(card) {
      dragged.current = { card };
      setPicked(null);
    },
    drop(slot) {
      if (dragged.current) dragged.current.slot = slot;
    },
    end(operation) {
      const d = dragged.current;
      dragged.current = null;
      if (operation === "move" && d && d.slot !== undefined) {
        move(d.card, d.slot);
      }
    },
  };

  // After a keyboard pick, the first slot with room takes focus.
  useEffect(() => {
    if (!picked || !focusSlot.current) return;
    focusSlot.current = false;
    const free = slots.find(
      (s) =>
        cards.filter((c) => placed[c.id] === s.id).length < s.capacity &&
        placed[picked] !== s.id,
    );
    const target =
      root.current?.querySelector<HTMLElement>(
        `.k-slot-hit[data-slot="${CSS.escape(free?.id ?? slots[0]?.id ?? "")}"]`,
      ) ?? root.current?.querySelector<HTMLElement>(".k-slot-hit");
    target?.focus();
  }, [picked]);

  // React Aria renders a collection one frame after its items change, so a
  // moved card's row is found on the next one. Focus goes there only if the
  // move left it nowhere, as when the element that had it is gone. Only a
  // pending move does anything, so this can run after every render.
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        return;
      }
      root.current
        ?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)
        ?.focus();
    });
  });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!live) return;
    const onCard = (e.target as Element).matches("[data-card]");
    if (e.key === "Escape" && picked) {
      refocus.current = picked;
      pick(null);
    } else if (onCard && e.key === " ") {
      e.preventDefault();
      const id = (e.target as HTMLElement).dataset.card ?? null;
      focusSlot.current = id !== picked;
      pick(id === picked ? null : id);
    } else if (onCard && e.key === "Enter") {
      enterPending.current = true;
    }
  };

  const list = (
    name: string,
    slot: string | null,
    className: string,
  ): ReactNode => {
    const here = cards.filter((c) => (placed[c.id] ?? null) === slot);
    return (
      <CardList
        name={name}
        slot={slot}
        className={className}
        cards={here.map((c) => ({ card: c, name: nameOfCard(c.id) }))}
        picked={picked}
        onAction={(card) => {
          focusSlot.current = enterPending.current && card !== picked;
          enterPending.current = false;
          pick(card === picked ? null : card);
        }}
        drag={drag}
        live={live}
      />
    );
  };
  const hit = (name: string, slot: string | null) =>
    live &&
    picked && (
      <Button
        className="k-slot-hit"
        aria-label={name}
        data-slot={slot ?? undefined}
        onPress={() => {
          // Focus goes on to the next card in the tray, or stays with the card put down.
          const next = cards.find(
            (c) => c.id !== picked && placed[c.id] === undefined,
          );
          move(picked, slot, slot === null ? undefined : next?.id);
        }}
      />
    );
  const slotOf = (id: string) => {
    const slot = slots.find((s) => s.id === id);
    if (!slot) return null;
    return (
      <span className="k-slot" data-more-item>
        {hit(m.card_place({ slot: slot.name }), slot.id)}
        {list(slot.name, slot.id, "k-slot-list")}
      </span>
    );
  };

  return (
    <div className="k-board" ref={root} onKeyDownCapture={onKeyDown}>
      <VisuallyHidden>
        <div aria-live="polite">{said}</div>
      </VisuallyHidden>
      <div className="k-tray">
        {picked && placed[picked] !== undefined
          ? hit(m.card_return(), null)
          : null}
        {list(m.cards_tray(), null, "k-tray-list")}
      </div>
      {children(slotOf)}
    </div>
  );
}

/** What a drag does on the board: it starts on a card and drops on a slot, or the tray when `null`. */
interface Drag {
  start: (card: string) => void;
  drop: (slot: string | null) => void;
  end: (operation: string) => void;
}

/** One grid list of cards, which is also a place cards are dropped on. */
function CardList({
  name,
  slot,
  className,
  cards,
  picked,
  onAction,
  drag,
  live,
}: {
  name: string;
  slot: string | null;
  className: string;
  cards: { card: Card; name: string }[];
  picked: string | null;
  onAction: (card: string) => void;
  drag: Drag;
  live: boolean;
}) {
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ [CARD_TYPE]: String(k) })),
    acceptedDragTypes: [CARD_TYPE],
    onDragStart: (e) => drag.start(String([...e.keys][0])),
    onDragEnd: (e) => drag.end(e.dropOperation),
    getDropOperation: () => "move",
    onRootDrop: () => drag.drop(slot),
  });
  return (
    <GridList
      className={className}
      aria-label={name}
      layout="grid"
      orientation="horizontal"
      selectionMode="none"
      onAction={live ? (key) => onAction(String(key)) : undefined}
      dragAndDropHooks={live ? dragAndDropHooks : undefined}
    >
      {cards.map(({ card, name }) => (
        <GridListItem
          key={card.id}
          id={card.id}
          className="k-card"
          textValue={name}
          aria-label={name}
          data-card={card.id}
          data-picked={picked === card.id || undefined}
        >
          {live && (
            <Button slot="drag" className="k-grip">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
              </svg>
            </Button>
          )}
          <CardFace card={card} />
        </GridListItem>
      ))}
    </GridList>
  );
}
