import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "react-aria-components/Button";
import { GridList, GridListItem } from "react-aria-components/GridList";
import { useDragAndDrop } from "react-aria-components/useDragAndDrop";
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
 * The tray and every slot are React Aria grid lists, so a card moves three
 * ways: dragged with the mouse, dragged by the keyboard (Enter on the card's
 * drag handle starts, Tab goes to a place, Enter drops), or picked and then
 * put down. A click, a tap or Space picks a card; a press on a slot's overlay
 * button puts it there, and a press on the tray's takes it back. A slot that
 * is full sends its card back to the tray (see {@link place}). Escape
 * unpicks. Focus follows a moved card.
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
  // The card React Aria has selected. After a drop it selects the card the
  // drop inserted, which the student has not picked: `settling` holds from the
  // start of a drag to the next input, and then `held` is empty. The selection
  // is cleared only after React Aria's own 50 ms drop window, since it
  // selects again while that window is open and nothing has changed.
  const [picked, setPicked] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const held = settling ? null : picked;
  // A press selects its card at once, but the press targets that appear for a
  // picked card must not get in the way of a drag the press may become.
  const [pressing, setPressing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const capacity = useMemo(
    () => Object.fromEntries(slots.map((s) => [s.id, s.capacity])),
    [slots],
  );
  const live = !readOnly && !!onChange;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each selection restarts the wait
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setPicked(null), 100);
    return () => clearTimeout(timer);
  }, [settling, picked]);
  useEffect(() => {
    if (!pressing) return;
    const release = () => setPressing(false);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    return () => {
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
    };
  }, [pressing]);
  const move = (card: string, slot: string | null) => {
    refocus.current = card;
    setPicked(null);
    onChange?.(place(placed, card, slot, capacity));
  };
  // A drag moves its card when it ends, not when the drop lands: a card that
  // leaves its list during the drop is detached before the browser's dragend,
  // and React Aria's drag state would never clear.
  const dragged = useRef<{ card: string; slot?: string | null } | null>(null);
  const drag: Drag = {
    start(card) {
      dragged.current = { card };
      setPressing(false);
      setSettling(true);
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

  // React Aria renders a collection one frame after its items change, so the
  // moved card's row is found on the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a move changes `placed`
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)
        ?.focus(),
    );
  }, [placed]);

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
        cards={here.map((c) => ({
          card: c,
          name: nameOf(
            c.content,
            m.card_label({ number: cards.indexOf(c) + 1 }),
          ),
        }))}
        picked={picked}
        held={held}
        onPick={setPicked}
        drag={drag}
        live={live}
      />
    );
  };
  const hit = (name: string, slot: string | null) =>
    live &&
    held && (
      <Button
        className="k-slot-hit"
        aria-label={name}
        onPress={() => move(held, slot)}
      />
    );
  // A click is input when it lands on a card or a press target; the browser
  // can also send one to the board after a drag.
  const clicked = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest("[data-card], .k-slot-hit")) {
      setSettling(false);
    }
  };
  const pressed = (e: PointerEvent<HTMLElement>) => {
    const onCard = !!(e.target as Element).closest("[data-card]");
    if (onCard || (e.target as Element).closest(".k-slot-hit")) {
      setSettling(false);
    }
    setPressing(onCard);
  };
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
    <div
      className="k-board"
      ref={root}
      data-pressing={pressing || undefined}
      onPointerDownCapture={pressed}
      onKeyDownCapture={() => setSettling(false)}
      onClickCapture={clicked}
    >
      <div className="k-tray">
        {held && placed[held] !== undefined ? hit(m.card_return(), null) : null}
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
  held,
  onPick,
  drag,
  live,
}: {
  name: string;
  slot: string | null;
  className: string;
  cards: { card: Card; name: string }[];
  picked: string | null;
  held: string | null;
  onPick: (card: string | null) => void;
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
      selectionMode={live ? "single" : "none"}
      selectedKeys={
        picked && cards.some((c) => c.card.id === picked) ? [picked] : []
      }
      onSelectionChange={(keys) => {
        const [key] = keys === "all" ? [] : keys;
        onPick(key === undefined ? null : String(key));
      }}
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
          data-picked={held === card.id || undefined}
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
