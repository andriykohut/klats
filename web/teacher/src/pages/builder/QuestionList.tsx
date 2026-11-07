import type { Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { RichView } from "@klats/shared/rich/RichView.tsx";
import { type ReactNode, useEffect, useRef } from "react";
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
import { listed, plainText } from "./model";
import { typeIcon } from "./types";

// «Показати»'s keys: a tag's is "#" and its name, so it never clashes with these.
const ALL = "all";
const NONE = "none";

/**
 * The left column: the questions `shown` picks (see {@link listed}), each
 * with its number in the test, type, first two lines of text, tags and
 * points, and a red dot on a question with a blocking problem. Once the test
 * has `known` tags, «Показати» above the list picks all questions, one tag or
 * those without a tag, and reports the pick to `onShow`. The header counts
 * the whole test. `children` are the add buttons under the list.
 */
export function QuestionList(props: {
  questions: Question[];
  selected: string;
  errors: Set<string>;
  shown: string | null;
  known: [string, number][];
  onSelect: (id: string) => void;
  onShow: (shown: string | null) => void;
  children: ReactNode;
}) {
  const { questions, selected, shown } = props;
  const list = useRef<HTMLDivElement>(null);
  const points = questions.reduce((sum, q) => sum + q.points, 0);

  // A question added or picked elsewhere may be out of view.
  useEffect(() => {
    list.current
      ?.querySelector(`[data-key="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <section className="t-panel b-list" aria-label={m.builder_questions()}>
      <header className="b-lh">
        <h2>{m.builder_questions()}</h2>
        <span>
          {m.builder_count_questions({ count: questions.length })},{" "}
          {m.builder_count_points({ count: points })}
        </span>
      </header>
      {props.known.length > 0 && (
        <Select
          className="b-show"
          value={shown === null ? ALL : shown === "" ? NONE : `#${shown}`}
          onChange={(key) => {
            const k = String(key);
            props.onShow(k === ALL ? null : k === NONE ? "" : k.slice(1));
          }}
        >
          <Label>{m.tags_show()}</Label>
          <Button className="b-show-btn">
            <SelectValue className="b-show-value" />
            <Icon name="caret" />
          </Button>
          <Popover className="b-pop" placement="bottom start">
            <ListBox className="b-show-list">
              <ListBoxItem id={ALL} className="b-tags-item">
                {m.tags_show_all()}
              </ListBoxItem>
              {props.known.map(([tag, count]) => (
                <ListBoxItem
                  key={tag}
                  id={`#${tag}`}
                  className="b-tags-item"
                  textValue={m.tags_show_tag({ tag })}
                >
                  {m.tags_show_tag({ tag })}{" "}
                  <span className="b-tags-n">({count})</span>
                </ListBoxItem>
              ))}
              <ListBoxItem id={NONE} className="b-tags-item">
                {m.tags_show_none()}
              </ListBoxItem>
            </ListBox>
          </Popover>
        </Select>
      )}
      <ListBox
        ref={list}
        className="b-qs"
        aria-label={m.builder_questions()}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={selected ? [selected] : []}
        onSelectionChange={(keys) => {
          const [key] = keys === "all" ? [] : keys;
          if (key !== undefined) props.onSelect(String(key));
        }}
      >
        {listed(questions, shown, selected).map(({ question: q, number }) => {
          const text = plainText(q.text);
          return (
            <ListBoxItem
              key={q.id}
              id={q.id}
              className="b-qi"
              textValue={`${number}. ${text || m.builder_new_question()}`}
            >
              <span className="b-qi-n">{number}</span>
              <span className="b-ic">
                <Icon name={typeIcon(q.type)} />
              </span>
              <span className="b-qi-main">
                <span className="b-qi-tx" data-empty={!text || undefined}>
                  {text ? <RichView doc={q.text} /> : m.builder_new_question()}
                </span>
                {q.tags?.length ? (
                  <span className="b-qi-tags">
                    {q.tags.map((t) => (
                      <span key={t} className="b-qi-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {props.errors.has(q.id) && (
                <span className="b-qi-warn">
                  <span className="b-sr">{m.builder_item_problem()}</span>
                </span>
              )}
              <span className="b-qi-pt">{q.points}</span>
            </ListBoxItem>
          );
        })}
      </ListBox>
      <footer className="b-lf">{props.children}</footer>
    </section>
  );
}
