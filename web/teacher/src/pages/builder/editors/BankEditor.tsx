import type { Option } from "@klats/shared/generated/testfmt.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import type { RichDoc } from "@klats/shared/rich/RichView.tsx";
import { useState } from "react";
import { gapsInBody, MAX_LIST, newOption, plainText, textDoc } from "../model";
import { RichField } from "../RichField";
import { ItemImage, ItemList, itemNames } from "./ItemList";
import type { EditorProps } from "./QuestionEditor";

const DECOYS = itemNames((i) => m.builder_bank_decoy({ number: i + 1 }), false);

/**
 * The body of a word bank question and its words. A word is an option whose
 * `target` is the id of the body gap it fills, and each gap has one word; the
 * chips in the body show their words. A word that names no gap in the body is
 * an extra word, which is what students get for it (the server clears the
 * target of a word whose gap is gone). Deleting a gap therefore moves its word
 * to «Зайві слова», and an undo that brings the gap back moves the word to it
 * again, as the word keeps its target.
 */
export function BankEditor({
  question: q,
  onChange,
  onRemoveItem,
}: EditorProps) {
  const body = (q.body ?? textDoc("")) as RichDoc;
  const gaps = gapsInBody(body);
  const [imageError, setImageError] = useState("");
  const wordOf = (gap: string) => q.options.find((o) => o.target === gap);
  const extra = q.options.filter((o) => !o.target || !gaps.includes(o.target));
  const shown = new Map(
    gaps.flatMap((id) => {
      const text = plainText(wordOf(id)?.content ?? textDoc(""));
      return text ? [[id, text] as const] : [];
    }),
  );

  /** Edits the word of gap `id`, adding it when the gap has none. */
  const editWord = (id: string, patch: Partial<Option>) =>
    onChange((x) =>
      x.options.some((o) => o.target === id)
        ? {
            ...x,
            options: x.options.map((o) =>
              o.target === id ? { ...o, ...patch } : o,
            ),
          }
        : {
            ...x,
            options: [...x.options, { ...newOption(), target: id, ...patch }],
          },
    );

  // The selected text becomes the word of the new gap.
  const startGap = (id: string, selected: string) =>
    onChange((x) => ({
      ...x,
      options: [...x.options, { ...newOption(selected), target: id }],
    }));

  return (
    <>
      <div className="b-lbl">
        {m.builder_bank_body()}
        <em>{m.builder_bank_body_hint()}</em>
      </div>
      <RichField
        gapped
        value={body}
        onChange={(doc) => onChange((x) => ({ ...x, body: doc }))}
        onGap={startGap}
        gapName={m.builder_bank_make_gap()}
        gapWords={shown}
        label={m.builder_bank_body()}
        placeholder={m.builder_bank_body_placeholder()}
      />

      {gaps.length > 0 && (
        <>
          <div className="b-lbl">
            {m.builder_bank_words()}
            <em>{m.builder_bank_words_hint()}</em>
          </div>
          <ul className="b-opts">
            {gaps.map((id, i) => {
              const word = wordOf(id);
              const label = m.builder_bank_word({ number: i + 1 });
              return (
                <li key={id} className="b-opt" data-item={word?.id}>
                  <span className="b-gap-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <RichField
                    inline
                    value={word?.content ?? textDoc("")}
                    onChange={(content) => editWord(id, { content })}
                    label={label}
                    placeholder={label}
                  />
                  <ItemImage
                    image={word?.image}
                    addLabel={m.builder_item_image({ item: label })}
                    removeLabel={m.builder_item_image_remove({ item: label })}
                    onChange={(image) => editWord(id, { image })}
                    onError={setImageError}
                  />
                </li>
              );
            })}
          </ul>
          {imageError && (
            <p className="b-rich-err" role="alert">
              {imageError}
            </p>
          )}
        </>
      )}

      <div className="b-lbl">
        {m.builder_bank_decoys()}
        <em>{m.builder_bank_decoys_hint()}</em>
      </div>
      <ItemList
        items={extra}
        names={DECOYS}
        addLabel={m.builder_add_bank_decoy()}
        create={newOption}
        max={MAX_LIST - (q.options.length - extra.length)}
        onChange={(fn) =>
          onChange((x) => {
            const live = gapsInBody((x.body ?? textDoc("")) as RichDoc);
            const isExtra = (o: Option) =>
              !o.target || !live.includes(o.target);
            return {
              ...x,
              options: [
                ...x.options.filter((o) => !isExtra(o)),
                ...fn(x.options.filter(isExtra)),
              ],
            };
          })
        }
        onRemoveItem={onRemoveItem}
      />
    </>
  );
}
