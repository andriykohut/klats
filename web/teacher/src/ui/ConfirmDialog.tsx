import { m } from "@klats/shared/paraglide/messages.js";
import type { ReactNode } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";

/**
 * A modal question with «Скасувати» and a red `confirm` button. Escape, a
 * click outside or «Скасувати» close it through `onOpenChange(false)`;
 * `onConfirm` leaves closing to the caller, which can keep the dialog open
 * while `pending`. `details` go under the text, `cancel` renames «Скасувати»,
 * and `variant` "primary" colours the confirm button as a step that loses
 * nothing.
 */
export function ConfirmDialog(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirm: string;
  onConfirm: () => void;
  pending?: boolean;
  details?: ReactNode;
  cancel?: string;
  variant?: "danger" | "primary";
}) {
  return (
    <ModalOverlay
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      isDismissable
      className="t-scrim"
    >
      <Modal className="t-modal">
        <Dialog role="alertdialog" className="t-dialog">
          <Heading slot="title">{props.title}</Heading>
          <p>{props.children}</p>
          {props.details}
          <div className="t-dialog-actions">
            <Button slot="close" className="t-btn" data-variant="quiet">
              {props.cancel ?? m.action_cancel()}
            </Button>
            <Button
              className="t-btn"
              data-variant={props.variant ?? "danger"}
              onPress={props.onConfirm}
              isPending={props.pending}
            >
              {props.confirm}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
