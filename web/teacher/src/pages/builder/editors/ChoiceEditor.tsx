import { m } from "@klats/shared/paraglide/messages.js";
import { BADGE_LETTERS } from "@klats/shared/student-ui/badges.ts";
import { ToggleButton } from "react-aria-components";
import { Icon } from "../../../ui/icons";
import { MAX_LIST, newOption } from "../model";
import { ItemList, type ItemNames } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

/** The letter of option `i` as students see it, or its number past the ninth. */
const letter = (i: number) => BADGE_LETTERS[i] ?? String(i + 1);

const NAMES: ItemNames = {
  field: (i) => m.builder_answer_placeholder({ letter: letter(i) }),
  image: (i) => m.builder_answer_image({ letter: letter(i) }),
  imageRemove: (i) => m.builder_answer_image_remove({ letter: letter(i) }),
  remove: (i) => m.builder_answer_delete({ letter: letter(i) }),
  removed: (i) => m.builder_answer_deleted({ letter: letter(i) }),
};

/**
 * The answers of a single- or multi-answer question, each with a toggle that
 * marks it correct. Single choice works like radio buttons, multiple choice
 * like checkboxes.
 */
export function ChoiceEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
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

  return (
    <>
      <div className="b-lbl">
        {m.builder_answers()}
        <em>
          {q.type === "multi"
            ? m.builder_answers_multi_hint()
            : m.builder_answers_single_hint()}
        </em>
      </div>
      <ItemList
        items={q.options}
        names={NAMES}
        addLabel={m.builder_add_answer()}
        create={newOption}
        max={MAX_LIST}
        onChange={(fn) => onChange((x) => ({ ...x, options: fn(x.options) }))}
        onRemoveItem={onRemoveItem}
        marked={(o) => o.correct}
        leading={(o, i) => (
          <ToggleButton
            className="b-ok"
            data-round={q.type === "single" || undefined}
            isSelected={o.correct}
            onChange={() => toggleCorrect(o.id)}
            aria-label={m.builder_answer_correct({ letter: letter(i) })}
          >
            <Icon name="check" />
          </ToggleButton>
        )}
      />
    </>
  );
}
