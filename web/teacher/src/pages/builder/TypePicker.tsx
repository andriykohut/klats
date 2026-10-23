import { m } from "@klats/shared/paraglide/messages.js";
import { useRef } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { Icon } from "../../ui/icons";
import { typeName } from "./ChoiceEditor";

type QuestionType = "single" | "multi";

const TYPES: { type: QuestionType; text: () => string }[] = [
  { type: "single", text: m.type_single_desc },
  { type: "multi", text: m.type_multi_desc },
];

/** «Додати питання»: a dialog of the question types; picking one calls `onPick`. */
export function TypePicker({
  onPick,
}: {
  onPick: (type: QuestionType) => void;
}) {
  return (
    <DialogTrigger>
      <Button className="t-btn b-add" data-variant="teal">
        <Icon name="plus" />
        {m.builder_add_question()}
      </Button>
      <ModalOverlay isDismissable className="t-scrim">
        <Modal className="t-modal">
          <Dialog className="t-dialog b-types">
            {({ close }) => (
              <Types
                onPick={(type) => {
                  close();
                  onPick(type);
                }}
              />
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function Types({ onPick }: { onPick: (type: QuestionType) => void }) {
  // A double-click must add one question, not two.
  const picked = useRef(false);
  return (
    <>
      <Heading slot="title">{m.types_title()}</Heading>
      <p>{m.types_text()}</p>
      <div className="b-tcards">
        {TYPES.map((t) => (
          <Button
            key={t.type}
            className="b-tc"
            onPress={() => {
              if (picked.current) return;
              picked.current = true;
              onPick(t.type);
            }}
          >
            <span className="b-ic b-ic-lg">
              <Icon name={t.type} />
            </span>
            <span>
              <b>{typeName(t.type)}</b>
              <span className="b-tc-text">{t.text()}</span>
            </span>
          </Button>
        ))}
      </div>
    </>
  );
}
