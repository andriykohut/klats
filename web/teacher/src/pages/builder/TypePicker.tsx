import { m } from "@klats/shared/paraglide/messages.js";
import { QUESTION_TYPES, type TypeGroup } from "@klats/shared/questionTypes.ts";
import { useContext, useId } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  OverlayTriggerStateContext,
} from "react-aria-components";
import { Icon } from "../../ui/icons";
import { GROUP_NAMES, TYPE_INFO, typeIcon } from "./types";

/** The groups of {@link QUESTION_TYPES}, in order, with their types. */
const GROUPS = QUESTION_TYPES.reduce<{ group: TypeGroup; types: string[] }[]>(
  (groups, { type, group }) => {
    const last = groups[groups.length - 1];
    if (last?.group === group) last.types.push(type);
    else groups.push({ group, types: [type] });
    return groups;
  },
  [],
);

/** «Додати питання»: a dialog of the question types; picking one calls `onPick`. */
export function TypePicker({ onPick }: { onPick: (type: string) => void }) {
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

function Types({ onPick }: { onPick: (type: string) => void }) {
  // A double-click must add one question, not two: the first press closes the
  // dialog, and a card does nothing while it is closed, also during its exit
  // animation.
  const dialog = useContext(OverlayTriggerStateContext);
  const id = useId();
  return (
    <>
      <Heading slot="title" level={2}>
        {m.types_title()}
      </Heading>
      <p>{m.types_text()}</p>
      {GROUPS.map(({ group, types }) => (
        <section
          key={group}
          className="b-tgrp"
          aria-labelledby={`${id}-${group}`}
        >
          <h3 id={`${id}-${group}`}>{GROUP_NAMES[group]()}</h3>
          <div className="b-tcards">
            {types.map((type) => (
              <Button
                key={type}
                className="b-tc"
                onPress={() => {
                  if (dialog?.isOpen) onPick(type);
                }}
              >
                <span className="b-ic b-ic-lg">
                  <Icon name={typeIcon(type)} />
                </span>
                <span>
                  <b>{TYPE_INFO[type].name()}</b>
                  <span className="b-tc-text">{TYPE_INFO[type].desc()}</span>
                </span>
              </Button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
