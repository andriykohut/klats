import type { DrawLine, Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useRef } from "react";
import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";
import { Icon } from "../../ui/icons";
import { Count } from "./Count";
import { drawTotal, sourceSize } from "./draw";
import { tagCounts } from "./model";

/** The most questions one line may ask for; the server refuses more. */
const MAX_COUNT = 1000;

/** A source's name: «усіх питань» for an empty `tag`, otherwise «# tag». */
const sourceName = (tag: string) => (tag === "" ? m.draw_all() : `# ${tag}`);

/**
 * The random draw's lines, each «[count] з [source]» with a remove button
 * while there are two or more. A source is all of `questions` or one of their
 * tags, each shown with its question count; a line's tag that no question
 * carries is offered too, so the line keeps it. A tag line asking for more
 * than its tag has gets a warning under it. «Додати рядок» adds one question
 * from the first tag no line uses, or from all questions once every tag has
 * a line. The total under the lines is {@link drawTotal}. Every change goes
 * to `onChange` as the whole new list.
 */
export function DrawLines(props: {
  lines: DrawLine[];
  questions: Question[];
  onChange: (lines: DrawLine[]) => void;
}) {
  const { lines, questions, onChange } = props;
  const add = useRef<HTMLButtonElement>(null);
  const known = tagCounts(questions);
  const unused = known.find(([t]) => !lines.some((l) => l.tag === t));
  const setLine = (i: number, patch: Partial<DrawLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <>
      <div className="s-lines">
        {lines.map((line, i) => {
          const size = sourceSize(questions, line.tag);
          const sources: [string, number][] = [
            ["", questions.length],
            ...known,
          ];
          if (!sources.some(([t]) => t === line.tag))
            sources.push([line.tag, 0]);
          return (
            <div key={i} className="s-line">
              <div className="s-line-row">
                <Count
                  label={`${m.draw_from()} ${sourceName(line.tag)}`}
                  value={line.count}
                  min={1}
                  max={MAX_COUNT}
                  onChange={(count) => setLine(i, { count })}
                />
                {/* A source's key is "#" and its tag, so all questions are "#". */}
                <Select
                  className="s-src"
                  value={`#${line.tag}`}
                  onChange={(key) => setLine(i, { tag: String(key).slice(1) })}
                >
                  <Label>{m.draw_from()}</Label>
                  <Button className="b-show-btn">
                    <SelectValue className="b-show-value s-src-value" />
                    <Icon name="caret" />
                  </Button>
                  <Popover className="b-pop" placement="bottom start">
                    <ListBox className="b-show-list">
                      {sources.map(([tag, count]) => (
                        <ListBoxItem
                          key={tag}
                          id={`#${tag}`}
                          className="b-tags-item s-src-item"
                          textValue={sourceName(tag)}
                        >
                          <span className="s-src-name">{sourceName(tag)}</span>{" "}
                          <span className="b-tags-n">{count}</span>
                        </ListBoxItem>
                      ))}
                    </ListBox>
                  </Popover>
                </Select>
                {lines.length > 1 && (
                  <Button
                    className="t-icon-btn"
                    data-variant="danger"
                    aria-label={m.draw_remove()}
                    onPress={() => {
                      // The button unmounts with its line, which would drop focus to the page.
                      add.current?.focus();
                      onChange(lines.filter((_, j) => j !== i));
                    }}
                  >
                    <Icon name="close" />
                  </Button>
                )}
              </div>
              {line.tag !== "" && line.count > size && (
                <p className="s-warn">
                  {m.draw_short({ tag: line.tag, count: size })}
                </p>
              )}
            </div>
          );
        })}
        <Button
          ref={add}
          className="t-btn s-add"
          data-variant="quiet"
          onPress={() =>
            onChange([...lines, { tag: unused?.[0] ?? "", count: 1 }])
          }
        >
          <Icon name="plus" />
          {m.draw_add()}
        </Button>
      </div>
      <p className="s-total">
        {m.draw_total({
          count: drawTotal(questions, lines),
          total: questions.length,
        })}
      </p>
    </>
  );
}
