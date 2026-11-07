import { m } from "@klats/shared/paraglide/messages.js";
import { useRef, useState } from "react";
import {
  Button,
  ComboBox,
  Dialog,
  DialogTrigger,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  Tag,
  TagGroup,
  TagList,
} from "react-aria-components";
import { Icon } from "../../../ui/icons";
import { addTag, MAX_LIST, MAX_TEXT, tagLabel, tagName } from "../model";

/**
 * «# Теги»: a button that shows a question's `tags` (see {@link tagLabel}),
 * or «Теги» when it has none, and opens a box with the tags as chips that
 * can be removed and a field that adds one. The field suggests the test's
 * `known` tags the question does not carry, with how many questions carry
 * each, and offers to create the typed name when the test has no tag of that
 * name in any case. Picking a suggestion, or pressing Enter, adds the tag (see
 * {@link addTag}), spelled as the test's tag that differs only in case when
 * there is one (see {@link tagName}); the field stops at {@link MAX_LIST} tags
 * of {@link MAX_TEXT} characters.
 * Every change hands the whole new list to `onChange`.
 */
export function TagsButton(props: {
  tags: string[];
  known: [string, number][];
  onChange: (tags: string[]) => void;
}) {
  const { tags, onChange } = props;
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const known = props.known.map(([t]) => t);
  const name = tagName(text, known);
  const { shown, more } = tagLabel(tags);

  const add = (raw: string) => {
    const next = addTag(tags, tagName(raw, known));
    if (next !== tags) onChange(next);
    setText("");
  };

  return (
    <DialogTrigger>
      <Button className="b-tags-btn" data-has={tags.length > 0 || undefined}>
        <span aria-hidden="true">#</span>
        {tags.length ? (
          <>
            <span className="b-sr">{m.tags_button()}:</span>
            <span className="b-tags-shown">{shown}</span>
            {more > 0 && <span className="b-tags-more">+{more}</span>}
          </>
        ) : (
          m.tags_button()
        )}
      </Button>
      <Popover className="b-pop b-tags-pop" placement="bottom start">
        <Dialog className="b-tags-dialog" aria-label={m.tags_button()}>
          {tags.length > 0 && (
            <TagGroup
              className="b-chips"
              aria-label={m.tags_button()}
              onRemove={(keys) => {
                // The chips unmount with the last one, which would drop focus to the page.
                if (keys.size >= tags.length) field.current?.focus();
                onChange(tags.filter((t) => !keys.has(t)));
              }}
            >
              <TagList
                className="b-chips-list"
                items={tags.map((id) => ({ id }))}
              >
                {({ id }) => (
                  <Tag className="b-chip" id={id} textValue={id}>
                    {id}
                    <Button
                      slot="remove"
                      className="t-icon-btn b-chip-x"
                      aria-label={m.tags_remove({ tag: id })}
                    >
                      <Icon name="close" />
                    </Button>
                  </Tag>
                )}
              </TagList>
            </TagGroup>
          )}
          <ComboBox
            className="t-field"
            aria-label={m.tags_field()}
            allowsCustomValue
            autoFocus
            inputValue={text}
            onInputChange={setText}
            isDisabled={tags.length >= MAX_LIST}
          >
            <Input
              ref={field}
              maxLength={MAX_TEXT}
              placeholder={m.tags_field()}
              onKeyDown={(e) => {
                // The combo box runs the action of an item the arrows reached.
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                if (!e.currentTarget.getAttribute("aria-activedescendant")) {
                  add(text);
                }
              }}
            />
            <Popover className="b-pop" placement="bottom start">
              <ListBox className="b-tags-list">
                {props.known
                  .filter(([t]) => !tags.includes(t))
                  .map(([t, count]) => (
                    <ListBoxItem
                      key={t}
                      id={t}
                      className="b-tags-item"
                      textValue={t}
                      onAction={() => add(t)}
                    >
                      {t} <span className="b-tags-n">({count})</span>
                    </ListBoxItem>
                  ))}
                {name && !props.known.some(([t]) => t === name) && (
                  // Its text is the field's, so the default filter keeps it.
                  <ListBoxItem
                    id={name}
                    className="b-tags-item"
                    textValue={text}
                    onAction={() => add(name)}
                  >
                    {m.tags_create({ tag: name })}
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </ComboBox>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
