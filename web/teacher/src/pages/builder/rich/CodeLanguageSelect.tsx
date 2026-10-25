import { CODE_LANGUAGES } from "@klats/shared/code/registry.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import {
  Button,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from "react-aria-components";

/** The key of the choice that leaves a code block without a language. */
const PLAIN = "plain";

/**
 * The «Мова» select of a code block's toolbar: «Без підсвічування» and the
 * languages of {@link CODE_LANGUAGES}. `value` is the block's language id or
 * null; `onChange` gets the chosen id or null. `onOpenChange` reports the list
 * opening and closing, because the toolbar has to stay visible while focus is
 * in the list.
 */
export function CodeLanguageSelect(props: {
  value: string | null;
  onChange: (language: string | null) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Select
      className="b-code-lang"
      aria-label={m.rich_code_language()}
      selectedKey={props.value ?? PLAIN}
      onSelectionChange={(key) =>
        props.onChange(key === PLAIN ? null : String(key))
      }
      onOpenChange={props.onOpenChange}
    >
      <Button className="b-code-lang-btn">
        <SelectValue />
      </Button>
      <Popover className="b-code-lang-pop" placement="bottom end">
        <ListBox className="b-code-lang-list">
          <ListBoxItem id={PLAIN} className="b-code-lang-item">
            {m.rich_code_plain()}
          </ListBoxItem>
          {CODE_LANGUAGES.map((l) => (
            <ListBoxItem key={l.id} id={l.id} className="b-code-lang-item">
              {l.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}
