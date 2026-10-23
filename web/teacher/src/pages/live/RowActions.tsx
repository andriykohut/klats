import type { LiveRow } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { useState } from "react";
import {
  Button,
  Dialog,
  FieldError,
  Form,
  Heading,
  Input,
  Label,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  TextField,
} from "react-aria-components";
import { busy, useKick, useRenameDevice } from "../../api/queries";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Icon } from "../../ui/icons";

/**
 * The «⋯» menu of a journal row and the dialogs it opens: «Від’єднати»,
 * confirmed first, and «Перейменувати комп’ютер». `name` is the student as
 * the journal shows them, initials while names are hidden, in the menu's
 * label and the confirmation alike.
 */
export function RowActions({ row, name }: { row: LiveRow; name: string }) {
  const [kicking, setKicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const kick = useKick();
  return (
    <>
      <MenuTrigger>
        <Button
          className="t-icon-btn j-menu-btn"
          aria-label={m.live_row_menu({ name })}
        >
          <Icon name="more" />
        </Button>
        <Popover placement="bottom end" className="j-menu-pop">
          <Menu
            className="j-menu"
            onAction={(key) =>
              key === "kick" ? setKicking(true) : setRenaming(true)
            }
          >
            <MenuItem id="rename" className="j-menu-item">
              {m.live_rename()}
            </MenuItem>
            <MenuItem id="kick" className="j-menu-item j-menu-danger">
              {m.live_kick()}
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <ConfirmDialog
        isOpen={kicking}
        onOpenChange={setKicking}
        title={m.live_kick_title({ name })}
        confirm={m.live_kick()}
        pending={kick.isPending}
        onConfirm={() => {
          if (busy("kick")) return;
          kick.mutate(row.participantId, {
            onSuccess: () => setKicking(false),
          });
        }}
      >
        {m.live_kick_text()}
      </ConfirmDialog>
      {renaming && (
        <RenameDialog row={row} onClose={() => setRenaming(false)} />
      )}
    </>
  );
}

const MAX_LABEL = 20;

/** Renames the computer of `row`; the label is 1 to 20 characters. */
function RenameDialog({ row, onClose }: { row: LiveRow; onClose: () => void }) {
  const rename = useRenameDevice();
  const [label, setLabel] = useState(row.deviceLabel);
  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      className="t-scrim"
    >
      <Modal className="t-modal">
        <Dialog className="t-dialog">
          <Heading slot="title">{m.live_rename()}</Heading>
          <p>{m.live_rename_text()}</p>
          <Form
            className="l-rename"
            onSubmit={(e) => {
              e.preventDefault();
              const v = label.trim();
              if (v === "" || v.length > MAX_LABEL || busy("renameDevice")) {
                return;
              }
              rename.mutate(
                { token: row.deviceToken, label: v },
                { onSuccess: onClose },
              );
            }}
          >
            <TextField
              className="t-field"
              value={label}
              onChange={setLabel}
              maxLength={MAX_LABEL}
              isRequired
              autoFocus
              validate={(v) =>
                v.trim() === "" ? m.live_rename_invalid() : null
              }
            >
              <Label>{m.live_rename_label()}</Label>
              <Input />
              <FieldError />
            </TextField>
            <div className="t-dialog-actions">
              <Button slot="close" className="t-btn" data-variant="quiet">
                {m.action_cancel()}
              </Button>
              <Button
                type="submit"
                className="t-btn"
                data-variant="teal"
                isPending={rename.isPending}
              >
                {m.action_save()}
              </Button>
            </div>
          </Form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
