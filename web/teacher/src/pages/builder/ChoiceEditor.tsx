import type { Option, Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { MediaImage } from "@klats/shared/rich/RichView.tsx";
import { BADGE_LETTERS } from "@klats/shared/student-ui/badges.ts";
import { useState } from "react";
import {
  Button,
  FileTrigger,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  SwitchButton,
  SwitchField,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import { cooldown } from "../../cooldown";
import { Icon } from "../../ui/icons";
import { addImage, mediaMessage } from "./media";
import { MAX_POINTS, MIN_POINTS, newOption, plainText } from "./model";
import { RichField } from "./RichField";

/** The letter of option `i` as students see it, or its number past the ninth. */
export const letter = (i: number) => BADGE_LETTERS[i] ?? String(i + 1);

/**
 * Edits one single- or multi-answer question: its type, points, answer
 * shuffling, text, options and, for multi, the scoring rule. Every edit goes
 * through `onChange` as a function of the newest question. Removing an option
 * goes through `onRemoveOption`, which owns the undo. Each option can carry
 * one picture: its row has a button that uploads one, and a thumbnail with a
 * × that removes it. The question text takes focus when `focusText` is not 0.
 */
export function ChoiceEditor(props: {
  question: Question;
  focusText: number;
  onChange: (fn: (q: Question) => Question) => void;
  onDelete: () => void;
  onRemoveOption: (optionId: string) => void;
}) {
  const { question: q, onChange } = props;
  const multi = q.type === "multi";
  // The option to focus, bumped on each request so a repeat still moves focus.
  const [focus, setFocus] = useState({ id: "", n: 0 });
  // Shared by the option × buttons, like each list's delete buttons.
  const [mayDelete] = useState(() => cooldown());
  const focusOn = (id: string) => setFocus((f) => ({ id, n: f.n + 1 }));
  const [imageError, setImageError] = useState("");

  const setOptions = (fn: (os: Option[]) => Option[]) =>
    onChange((x) => ({ ...x, options: fn(x.options) }));

  const setImage = (id: string, image: Option["image"]) =>
    setOptions((os) => os.map((x) => (x.id === id ? { ...x, image } : x)));

  // The picture is set only once it is uploaded, so a failure leaves the row as it was.
  const pickImage = async (id: string, file: File | undefined) => {
    if (!file) return;
    setImageError("");
    try {
      setImage(id, await addImage(file));
    } catch (err) {
      setImageError(mediaMessage(err));
    }
  };

  const addAfter = (index: number) => {
    const o = newOption();
    setOptions((os) => [...os.slice(0, index + 1), o, ...os.slice(index + 1)]);
    focusOn(o.id);
  };

  // Enter moves on to an empty next option rather than adding one before it.
  const enterFrom = (index: number) => {
    const next = q.options[index + 1];
    if (next && !plainText(next.content)) focusOn(next.id);
    else addAfter(index);
  };

  const remove = (index: number, moveFocus: boolean) => {
    const near = q.options[index - 1] ?? q.options[index + 1];
    props.onRemoveOption(q.options[index].id);
    if (moveFocus && near) focusOn(near.id);
  };

  // Single choice works like radio buttons, multi like checkboxes.
  const toggleCorrect = (id: string) =>
    onChange((x) => ({
      ...x,
      options: x.options.map((o) =>
        o.id === id
          ? { ...o, correct: !o.correct }
          : x.type === "single"
            ? { ...o, correct: false }
            : o,
      ),
    }));

  const addPoints = (d: number) =>
    onChange((x) => ({
      ...x,
      points: Math.min(MAX_POINTS, Math.max(MIN_POINTS, x.points + d)),
    }));

  return (
    <div className="b-ed-in">
      <div className="b-row">
        <Select
          className="b-type"
          aria-label={m.builder_type_label()}
          value={q.type}
          onChange={(type) =>
            type && onChange((x) => ({ ...x, type: String(type) }))
          }
        >
          <Button className="b-type-btn">
            <SelectValue className="b-type-value" />
            <Icon name="caret" />
          </Button>
          <Popover className="b-pop" placement="bottom start">
            <ListBox className="b-type-list">
              {(["single", "multi"] as const).map((t) => (
                <ListBoxItem
                  key={t}
                  id={t}
                  className="b-type-item"
                  textValue={typeName(t)}
                >
                  <span className="b-ic b-ic-sm">
                    <Icon name={t} />
                  </span>
                  {typeName(t)}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
        <div className="b-pts">
          <Button
            aria-label={m.builder_points_less()}
            isDisabled={q.points <= MIN_POINTS}
            onPress={() => addPoints(-1)}
          >
            <Icon name="minus" />
          </Button>
          <span aria-live="polite">
            {m.builder_count_points({ count: q.points })}
          </span>
          <Button
            aria-label={m.builder_points_more()}
            isDisabled={q.points >= MAX_POINTS}
            onPress={() => addPoints(1)}
          >
            <Icon name="plus" />
          </Button>
        </div>
        <SwitchField
          className="b-tog"
          isSelected={q.shuffleOptions}
          onChange={(on) => onChange((x) => ({ ...x, shuffleOptions: on }))}
        >
          <SwitchButton className="b-tog-btn">
            <i className="b-tog-track" aria-hidden="true" />
            {m.builder_shuffle()}
          </SwitchButton>
        </SwitchField>
        <Button
          className="t-icon-btn b-del-q"
          data-variant="danger"
          aria-label={m.builder_delete_question()}
          onPress={props.onDelete}
        >
          <Icon name="trash" />
        </Button>
      </div>

      <div className="b-lbl">{m.builder_question_text()}</div>
      <RichField
        value={q.text}
        onChange={(doc) => onChange((x) => ({ ...x, text: doc }))}
        label={m.builder_question_text()}
        placeholder={m.builder_question_placeholder()}
        focus={props.focusText}
      />

      <div className="b-lbl">
        {m.builder_answers()}
        <em>
          {multi
            ? m.builder_answers_multi_hint()
            : m.builder_answers_single_hint()}
        </em>
      </div>
      <ul className="b-opts" data-type={q.type}>
        {q.options.map((o, i) => (
          <li
            key={o.id}
            className="b-opt"
            data-correct={o.correct || undefined}
          >
            <ToggleButton
              className="b-ok"
              isSelected={o.correct}
              onChange={() => toggleCorrect(o.id)}
              aria-label={m.builder_answer_correct({ letter: letter(i) })}
            >
              <Icon name="check" />
            </ToggleButton>
            <RichField
              inline
              value={o.content}
              onChange={(doc) =>
                setOptions((os) =>
                  os.map((x) => (x.id === o.id ? { ...x, content: doc } : x)),
                )
              }
              label={m.builder_answer_placeholder({ letter: letter(i) })}
              placeholder={m.builder_answer_placeholder({ letter: letter(i) })}
              focus={focus.id === o.id ? focus.n : 0}
              onEnter={() => enterFrom(i)}
              onEmptyBackspace={() => remove(i, true)}
            />
            {o.image && (
              <span className="b-opt-pic">
                <MediaImage
                  src={o.image.src}
                  w={o.image.w}
                  h={o.image.h}
                  className="b-opt-thumb"
                />
                <Button
                  className="t-icon-btn b-opt-pic-x"
                  data-variant="danger"
                  aria-label={m.builder_answer_image_remove({
                    letter: letter(i),
                  })}
                  onPress={() => setImage(o.id, undefined)}
                >
                  <Icon name="close" />
                </Button>
              </span>
            )}
            <FileTrigger
              acceptedFileTypes={["image/*"]}
              onSelect={(files) => void pickImage(o.id, files?.[0])}
            >
              <Button
                className="t-icon-btn b-opt-img"
                aria-label={m.builder_answer_image({ letter: letter(i) })}
              >
                <Icon name="image" />
              </Button>
            </FileTrigger>
            <Button
              className="t-icon-btn b-opt-del"
              data-variant="danger"
              aria-label={m.builder_answer_delete({ letter: letter(i) })}
              onPress={() => mayDelete() && remove(i, false)}
            >
              <Icon name="close" />
            </Button>
          </li>
        ))}
      </ul>
      {imageError && (
        <p className="b-rich-err" role="alert">
          {imageError}
        </p>
      )}
      <Button
        className="t-btn b-add-opt"
        data-variant="dashed"
        onPress={() => addAfter(q.options.length - 1)}
      >
        <Icon name="plus" />
        {m.builder_add_answer()}
      </Button>

      {multi && (
        <>
          <div className="b-lbl">{m.builder_grading()}</div>
          <ToggleButtonGroup
            className="b-seg"
            aria-label={m.builder_grading()}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[q.partial ? "partial" : "all"]}
            onSelectionChange={(keys) =>
              onChange((x) => ({ ...x, partial: keys.has("partial") }))
            }
          >
            <ToggleButton id="partial" className="b-seg-btn">
              {m.builder_partial()}
            </ToggleButton>
            <ToggleButton id="all" className="b-seg-btn">
              {m.builder_all_or_nothing()}
            </ToggleButton>
          </ToggleButtonGroup>
          <p className="b-hint">
            {q.partial ? m.builder_partial_hint() : m.builder_all_hint()}
          </p>
        </>
      )}
    </div>
  );
}

/** The name of a question type, as students see it on the sheet. */
export const typeName = (type: string) =>
  type === "multi" ? m.answer_multi() : m.answer_single();
