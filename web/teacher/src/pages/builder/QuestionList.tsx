import type { Question } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { RichView } from "@klats/shared/rich/RichView.tsx";
import { type ReactNode, useEffect, useRef } from "react";
import { ListBox, ListBoxItem } from "react-aria-components";
import { Icon } from "../../ui/icons";
import { plainText } from "./model";
import { typeIcon } from "./types";

/**
 * The left column: every question with its number, type, first two lines of
 * text and points, and a red dot on a question with a blocking problem.
 * `children` are the add buttons under the list.
 */
export function QuestionList(props: {
  questions: Question[];
  selected: string;
  errors: Set<string>;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const { questions, selected } = props;
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
        {questions.map((q, i) => {
          const text = plainText(q.text);
          return (
            <ListBoxItem
              key={q.id}
              id={q.id}
              className="b-qi"
              textValue={`${i + 1}. ${text || m.builder_new_question()}`}
            >
              <span className="b-qi-n">{i + 1}</span>
              <span className="b-ic">
                <Icon name={typeIcon(q.type)} />
              </span>
              <span className="b-qi-tx" data-empty={!text || undefined}>
                {text ? <RichView doc={q.text} /> : m.builder_new_question()}
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
