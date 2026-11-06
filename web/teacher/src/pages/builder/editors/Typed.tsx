import type { Match, Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useRef, useState } from "react";
import {
  Button,
  Input,
  SwitchButton,
  SwitchField,
  Tag,
  TagGroup,
  TagList,
  Text,
  TextField,
} from "react-aria-components";
import { Icon } from "../../../ui/icons";
import { insertAt, MAX_LIST, MAX_TEXT } from "../model";
import type { RemoveItem } from "./ItemList";

/**
 * The accepted answers of a short question or a typed gap, as chips with a
 * field under them: Enter adds the text in the field. A blank text and one
 * already listed add nothing, and the list stops at {@link MAX_LIST} chips of
 * {@link MAX_TEXT} characters. Removing a chip goes through `onRemoveItem`,
 * which owns the undo. `label` names the list and `addLabel` the field.
 */
export function AcceptedList(props: {
  values: string[];
  label: string;
  addLabel: string;
  removeLabel: (text: string) => string;
  onChange: (fn: (texts: string[]) => string[]) => void;
  onRemoveItem: RemoveItem;
}) {
  const { values, onChange } = props;
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);

  const add = () => {
    const t = text.trim();
    if (t) {
      onChange((xs) =>
        xs.includes(t) || xs.length >= MAX_LIST ? xs : [...xs, t],
      );
    }
    setText("");
  };

  const remove = (t: string) => {
    const index = values.indexOf(t);
    // The chips unmount with the last one, which would drop focus to the page.
    if (values.length === 1) field.current?.focus();
    props.onRemoveItem(
      m.builder_item_removed({ item: `«${t}»` }),
      () => onChange((xs) => xs.filter((x) => x !== t)),
      () => onChange((xs) => (xs.includes(t) ? xs : insertAt(xs, index, t))),
    );
  };

  return (
    <>
      {values.length > 0 && (
        <TagGroup
          className="b-chips"
          aria-label={props.label}
          onRemove={(keys) => {
            for (const key of keys) remove(String(key));
          }}
        >
          <TagList
            className="b-chips-list"
            items={values.map((id) => ({ id }))}
          >
            {({ id }) => (
              <Tag className="b-chip" id={id} textValue={id}>
                {id}
                <Button
                  slot="remove"
                  className="t-icon-btn b-chip-x"
                  aria-label={props.removeLabel(id)}
                >
                  <Icon name="close" />
                </Button>
              </Tag>
            )}
          </TagList>
        </TagGroup>
      )}
      <TextField
        className="t-field b-chip-add"
        aria-label={props.addLabel}
        value={text}
        onChange={setText}
        isDisabled={values.length >= MAX_LIST}
      >
        <Input
          ref={field}
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_TEXT}
          placeholder={m.builder_accepted_placeholder()}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            add();
          }}
        />
      </TextField>
    </>
  );
}

/** A match with every switch off, which is what a question without one grades by. */
const PLAIN: Match = {
  caseSensitive: false,
  strictApostrophes: false,
  strictLetters: false,
  allowTypo: false,
};

/** The switches that make the comparison looser; each is on when its `Match` field is off. */
const LOOSE = [
  ["caseSensitive", m.builder_match_case],
  ["strictApostrophes", m.builder_match_apostrophes],
  ["strictLetters", m.builder_match_letters],
] as const;

/**
 * «Порівняння»: the switches for comparing a typed text with the accepted
 * answers, in the order of the server's `Match`. The first three are on by
 * default and map to the negated fields, so a question without `match` shows
 * them on, as the grader treats it. «Зараховувати з однією помилкою» is off by default.
 * Every edit goes through `onChange` as a function of the newest question.
 */
export function MatchSwitches(props: {
  question: Question;
  onChange: (fn: (q: Question) => Question) => void;
}) {
  const match = props.question.match ?? PLAIN;
  const set = (patch: Partial<Match>) =>
    props.onChange((x) => ({
      ...x,
      match: { ...(x.match ?? PLAIN), ...patch },
    }));
  return (
    <>
      <div className="b-lbl">
        {m.builder_match()}
        <em>{m.builder_match_hint()}</em>
      </div>
      <div className="b-match">
        {LOOSE.map(([key, label]) => (
          <SwitchField
            key={key}
            className="b-tog"
            isSelected={!match[key]}
            onChange={(on) => set({ [key]: !on })}
          >
            <SwitchButton className="b-tog-btn">
              <i className="b-tog-track" aria-hidden="true" />
              {label()}
            </SwitchButton>
          </SwitchField>
        ))}
        <SwitchField
          className="b-tog"
          isSelected={match.allowTypo}
          onChange={(on) => set({ allowTypo: on })}
        >
          <SwitchButton className="b-tog-btn">
            <i className="b-tog-track" aria-hidden="true" />
            {m.builder_match_typo()}
          </SwitchButton>
          <Text slot="description" className="b-hint">
            {m.builder_match_typo_hint()}
          </Text>
        </SwitchField>
      </div>
    </>
  );
}
