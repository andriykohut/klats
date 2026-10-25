import { useId } from "react";
import {
  RadioButton,
  RadioField,
  RadioGroup,
} from "react-aria-components/RadioGroup";
import type { StudentOption, StudentTarget } from "../../generated/wire";
import { MediaImage, RichView } from "../../rich/RichView";
import type { AnswerProps } from "./AnswerArea";
import "./choice.css";

/**
 * A choice grid: a table with a row for each of the question's options and a
 * column for each of its targets, and one radio group per row, named by the
 * row. The answer's `pairs` map a row's id to the id of its column, and a row
 * left alone has no entry. The column headers stay in view while the sheet
 * scrolls, and each row is marked `data-more-item` for the overflow cue.
 */
export function GridAnswers({
  question,
  answer,
  onChange,
  readOnly,
  labelledBy,
  describedBy,
}: AnswerProps) {
  const pairs = answer?.pairs ?? {};
  const columns = question.targets ?? [];
  const base = useId();
  const columnId = (i: number) => `${base}-c${i}`;
  return (
    <table
      className="k-grid"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      <thead>
        <tr>
          <td className="k-grid-corner" />
          {columns.map((c, i) => (
            <th key={c.id} id={columnId(i)} scope="col">
              <Cell item={c} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {question.options.map((o) => (
          <Row
            key={o.id}
            option={o}
            columns={columns}
            columnId={columnId}
            value={pairs[o.id] ?? null}
            readOnly={readOnly}
            onChange={(v) => onChange?.({ pairs: { ...pairs, [o.id]: v } })}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  option,
  columns,
  columnId,
  value,
  readOnly,
  onChange,
}: {
  option: StudentOption;
  columns: StudentTarget[];
  columnId: (index: number) => string;
  value: string | null;
  readOnly?: boolean;
  onChange: (columnId: string) => void;
}) {
  const rowId = useId();
  return (
    <tr data-more-item>
      <th className="k-grid-row" id={rowId} scope="row">
        <Cell item={option} />
      </th>
      <td colSpan={columns.length}>
        <RadioGroup
          className="k-grid-cells"
          style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
          aria-labelledby={rowId}
          orientation="horizontal"
          isReadOnly={readOnly}
          value={value}
          onChange={onChange}
        >
          {columns.map((c, i) => (
            <RadioField
              key={c.id}
              value={c.id}
              className="k-grid-field"
              aria-labelledby={columnId(i)}
            >
              <RadioButton className="k-dot">
                <span className="k-dot-mark" />
              </RadioButton>
            </RadioField>
          ))}
        </RadioGroup>
      </td>
    </tr>
  );
}

/** A row's or column's picture, if it has one, above its text. */
function Cell({ item }: { item: StudentOption | StudentTarget }) {
  return (
    <>
      {item.image && (
        <MediaImage
          className="k-pick-img"
          src={item.image.src}
          w={item.image.w}
          h={item.image.h}
        />
      )}
      <RichView doc={item.content} />
    </>
  );
}
