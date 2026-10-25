import type { Choice, Gap } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import { Icon } from "../../../ui/icons";
import {
  gapInMode,
  gapsInBody,
  insertAt,
  MAX_LIST,
  MAX_TEXT,
  newId,
  syncGaps,
  textDoc,
} from "../model";
import { RichField } from "../RichField";
import type { RemoveItem } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";
import { AcceptedList, MatchSwitches } from "./Typed";

/**
 * The body of a gaps question, and a card for each gap in it, in body order:
 * a typed gap holds accepted answers as chips, and a list gap holds plain-text
 * choices, one marked right. The matching switches come last.
 *
 * The question's `gaps` hold only the entries of gaps that are in the body, in
 * body order (see {@link syncGaps}); the entry of a gap that has left the body
 * waits in this editor, so that an undo in the text brings the gap back with
 * its answers. A gap is a list gap while its entry has `choices`, even an empty
 * list, and saves only that mode's fields (see {@link gapInMode}).
 */
export function GapsEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  const body = (q.body ?? textDoc("")) as RichDoc;
  const stash = useRef(new Map<string, Gap>());
  // Each gap's entry as it was before its last switch between typed and list.
  const spare = useRef(new Map<string, Gap>());
  const ids = gapsInBody(body);
  const entries = new Map(q.gaps?.map((g) => [g.id, g]));

  /** Applies `fn` to the entry of gap `id` in the newest question. */
  const editGap = (id: string, fn: (g: Gap) => Gap) =>
    onChange((x) => ({
      ...x,
      gaps: syncGaps(
        x.gaps,
        (x.body ?? textDoc("")) as RichDoc,
        stash.current,
      ).map((g) => (g.id === id ? fn(g) : g)),
    }));

  const setBody = (doc: RichDoc) =>
    onChange((x) => ({
      ...x,
      body: doc,
      gaps: syncGaps(x.gaps, doc, stash.current),
    }));

  // The selected text becomes the first accepted answer of the new gap, which
  // the stash hands to the entry when the node arrives in the body.
  const startGap = (id: string, selected: string) => {
    if (selected && selected.length <= MAX_TEXT) {
      stash.current.set(id, { id, accepted: [selected] });
    }
  };

  return (
    <>
      <div className="b-lbl">
        {m.builder_gaps_body()}
        <em>{m.builder_gaps_body_hint()}</em>
      </div>
      <RichField
        gapped
        value={body}
        onChange={setBody}
        onGap={startGap}
        label={m.builder_gaps_body()}
        placeholder={m.builder_gaps_body_placeholder()}
      />
      {ids.map((id, i) => (
        <GapCard
          key={id}
          number={i + 1}
          gap={entries.get(id) ?? { id }}
          isList={entries.get(id)?.choices !== undefined}
          onMode={(list) => {
            const g = entries.get(id) ?? { id };
            const next = gapInMode(g, list, spare.current.get(id), () => [
              newChoice(),
              newChoice(),
            ]);
            spare.current.set(id, g);
            editGap(id, () => next);
          }}
          onChange={(fn) => editGap(id, fn)}
          onRemoveItem={onRemoveItem}
        />
      ))}
      <MatchSwitches question={q} onChange={onChange} />
    </>
  );
}

const newChoice = (): Choice => ({ id: newId(), text: "", correct: false });

/** The card of one gap: how the student answers it, and the answers. */
function GapCard(props: {
  number: number;
  gap: Gap;
  isList: boolean;
  onMode: (list: boolean) => void;
  onChange: (fn: (g: Gap) => Gap) => void;
  onRemoveItem: RemoveItem;
}) {
  const { number, gap, isList, onChange } = props;
  return (
    <fieldset className="b-gap-card" aria-label={m.builder_gap({ number })}>
      <header className="b-gap-head">
        <span className="b-gap-n" aria-hidden="true">
          {number}
        </span>
        <ToggleButtonGroup
          className="b-seg"
          aria-label={m.builder_gap_mode({ number })}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[isList ? "list" : "typed"]}
          onSelectionChange={(keys) => props.onMode(keys.has("list"))}
        >
          <ToggleButton id="typed" className="b-seg-btn">
            {m.builder_gap_typed()}
          </ToggleButton>
          <ToggleButton id="list" className="b-seg-btn">
            {m.builder_gap_list()}
          </ToggleButton>
        </ToggleButtonGroup>
      </header>
      {isList ? (
        <Choices
          choices={gap.choices ?? []}
          onChange={(fn) =>
            onChange((g) => ({ ...g, choices: fn(g.choices ?? []) }))
          }
          onRemoveItem={props.onRemoveItem}
        />
      ) : (
        <AcceptedList
          values={gap.accepted ?? []}
          label={m.builder_gap_accepted({ number })}
          addLabel={m.builder_gap_accepted_add({ number })}
          removeLabel={(text) => m.builder_accepted_remove({ text })}
          onChange={(fn) =>
            onChange((g) => ({ ...g, accepted: fn(g.accepted ?? []) }))
          }
          onRemoveItem={props.onRemoveItem}
        />
      )}
    </fieldset>
  );
}

/**
 * The choices of a list gap: plain text, no pictures, each with a round toggle
 * that marks it the right one (one at a time). Enter adds a choice after the
 * one being typed in.
 */
function Choices(props: {
  choices: Choice[];
  onChange: (fn: (choices: Choice[]) => Choice[]) => void;
  onRemoveItem: RemoveItem;
}) {
  const { choices, onChange } = props;
  const list = useRef<HTMLUListElement>(null);
  const [focus, setFocus] = useState("");
  const name = (i: number) => m.builder_gap_choice({ number: i + 1 });

  useEffect(() => {
    if (focus) {
      list.current
        ?.querySelector<HTMLElement>(`[data-choice="${focus}"] input`)
        ?.focus();
    }
  }, [focus]);

  const addAfter = (index: number) => {
    if (choices.length >= MAX_LIST) return;
    const c = newChoice();
    onChange((xs) => insertAt(xs, index + 1, c));
    setFocus(c.id);
  };

  const remove = (index: number) => {
    const gone = choices[index];
    props.onRemoveItem(
      m.builder_item_removed({ item: name(index) }),
      () => onChange((xs) => xs.filter((x) => x.id !== gone.id)),
      () => onChange((xs) => insertAt(xs, index, gone)),
    );
  };

  return (
    <>
      <ul className="b-opts" ref={list}>
        {choices.map((c, i) => (
          <li
            key={c.id}
            className="b-opt"
            data-choice={c.id}
            data-correct={c.correct || undefined}
          >
            <ToggleButton
              className="b-ok"
              data-round
              isSelected={c.correct}
              aria-label={m.builder_gap_choice_correct({ number: i + 1 })}
              onChange={() =>
                onChange((xs) =>
                  xs.map((x) => ({
                    ...x,
                    correct: x.id === c.id ? !x.correct : false,
                  })),
                )
              }
            >
              <Icon name="check" />
            </ToggleButton>
            <TextField
              className="t-field b-choice"
              aria-label={name(i)}
              value={c.text}
              onChange={(text) =>
                onChange((xs) =>
                  xs.map((x) => (x.id === c.id ? { ...x, text } : x)),
                )
              }
            >
              <Input
                autoComplete="off"
                maxLength={MAX_TEXT}
                placeholder={name(i)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  addAfter(i);
                }}
              />
            </TextField>
            <Button
              className="t-icon-btn b-opt-del"
              data-variant="danger"
              aria-label={m.builder_item_delete({ item: name(i) })}
              onPress={() => remove(i)}
            >
              <Icon name="close" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        className="t-btn b-add-opt"
        data-variant="dashed"
        isDisabled={choices.length >= MAX_LIST}
        onPress={() => addAfter(choices.length - 1)}
      >
        <Icon name="plus" />
        {m.builder_gap_add_choice()}
      </Button>
    </>
  );
}
