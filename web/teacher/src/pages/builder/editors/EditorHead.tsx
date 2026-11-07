import type { Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { QUESTION_TYPES } from "@klats/shared/questionTypes.ts";
import {
  Button,
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
import { Icon } from "../../../ui/icons";
import { convertQuestion, MAX_POINTS, MIN_POINTS } from "../model";
import {
  HAS_PARTIAL,
  HAS_SHUFFLE,
  PARTIAL_HINTS,
  TYPE_INFO,
  typeIcon,
} from "../types";
import { TagsButton } from "./TagsButton";

/**
 * The top row of a question's editor: its type, with all fifteen types and
 * their icons (choosing one converts the question, see {@link convertQuestion}),
 * its points, its tags (see {@link TagsButton}, which suggests the test's
 * `known` tags), whether the answers are shuffled for each student (only for
 * the types that shuffle by choice), and a button that deletes the question.
 */
export function EditorHead(props: {
  question: Question;
  known: [string, number][];
  onChange: (fn: (q: Question) => Question) => void;
  onDelete: () => void;
}) {
  const { question: q, onChange } = props;

  const addPoints = (d: number) =>
    onChange((x) => ({
      ...x,
      points: Math.min(MAX_POINTS, Math.max(MIN_POINTS, x.points + d)),
    }));

  return (
    <div className="b-row">
      <Select
        className="b-type"
        aria-label={m.builder_type_label()}
        value={q.type}
        onChange={(type) =>
          type && onChange((x) => convertQuestion(x, String(type)))
        }
      >
        <Button className="b-type-btn">
          <SelectValue className="b-type-value" />
          <Icon name="caret" />
        </Button>
        <Popover className="b-pop" placement="bottom start">
          <ListBox className="b-type-list">
            {QUESTION_TYPES.map(({ type }) => (
              <ListBoxItem
                key={type}
                id={type}
                className="b-type-item"
                textValue={TYPE_INFO[type].name()}
              >
                <span className="b-ic b-ic-sm">
                  <Icon name={typeIcon(type)} />
                </span>
                {TYPE_INFO[type].name()}
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
      <TagsButton
        tags={q.tags ?? []}
        known={props.known}
        onChange={(tags) => onChange((x) => ({ ...x, tags }))}
      />
      {HAS_SHUFFLE.has(q.type) && (
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
      )}
      <Button
        className="t-icon-btn b-del-q"
        data-variant="danger"
        aria-label={m.builder_delete_question()}
        onPress={props.onDelete}
      >
        <Icon name="trash" />
      </Button>
    </div>
  );
}

/**
 * «Оцінювання»: the choice between partial credit and all or nothing, with a
 * hint for the type, which goes under the editor of a type that scores by
 * parts. Nothing shows for the other types.
 */
export function Grading(props: {
  question: Question;
  onChange: (fn: (q: Question) => Question) => void;
}) {
  const { question: q } = props;
  if (!HAS_PARTIAL.has(q.type)) return null;
  const allHint =
    q.type === "multi" ? m.builder_all_hint : m.builder_all_hint_every;
  return (
    <>
      <div className="b-lbl">{m.builder_grading()}</div>
      <ToggleButtonGroup
        className="b-seg"
        aria-label={m.builder_grading()}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[q.partial ? "partial" : "all"]}
        onSelectionChange={(keys) =>
          props.onChange((x) => ({ ...x, partial: keys.has("partial") }))
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
        {q.partial ? PARTIAL_HINTS[q.type]() : allHint()}
      </p>
    </>
  );
}
