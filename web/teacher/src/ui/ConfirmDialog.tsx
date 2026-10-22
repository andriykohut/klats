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
 * while `pending`.
 */
export function ConfirmDialog(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirm: string;
  onConfirm: () => void;
  pending?: boolean;
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
          <div className="t-dialog-actions">
            <Button slot="close" className="t-btn" data-variant="quiet">
              {m.action_cancel()}
            </Button>
            <Button
              className="t-btn"
              data-variant="danger"
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
