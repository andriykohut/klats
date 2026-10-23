import { m } from "@klats/shared/paraglide/messages.js";
import { Button, Dialog, Modal, ModalOverlay } from "react-aria-components";
import { useNetwork } from "../../api/queries";
import { useFlags } from "../../flags";
import { portBusyText } from "../../ui/Banners";

/**
 * The board view, for the projector: the students' address, the join code
 * and a QR code of the address with the code, over the whole window, sized to
 * read from the back of a classroom. It shows how many have finished and
 * never a name or grade. Escape or «Закрити» closes it. Without an address
 * (no network, or the student server's port is busy) it says why instead.
 */
export function BoardView(props: {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  finished: number;
  total: number;
}) {
  const { data: net } = useNetwork();
  const { portSaved } = useFlags();
  const url = net?.url ?? "";
  const link = `${url}/?code=${props.code}`;
  return (
    <ModalOverlay
      isOpen={props.isOpen}
      onOpenChange={(open) => !open && props.onClose()}
      isDismissable
      className="l-board-scrim"
    >
      <Modal className="l-board">
        <Dialog className="l-board-dialog" aria-label={m.live_show_board()}>
          <Button className="l-ghost l-board-close" onPress={props.onClose}>
            {m.action_close()}
          </Button>
          <div className="l-board-big">
            {url ? (
              <>
                <small>{m.board_open()}</small>
                <p className="l-board-addr">
                  {url.replace(/^https?:\/\//, "")}
                </p>
              </>
            ) : (
              <p className="l-board-none">
                {net?.error === "port_busy"
                  ? portBusyText(net.port, portSaved)
                  : m.network_none()}
              </p>
            )}
            <small>{m.board_enter_code()}</small>
            <p className="l-board-code">{props.code}</p>
          </div>
          {url && (
            <figure className="l-board-qr">
              <img
                src={`/api/qr?text=${encodeURIComponent(link)}`}
                alt={m.board_qr()}
                width={512}
                height={512}
              />
              <figcaption>{m.board_scan()}</figcaption>
            </figure>
          )}
          <p className="l-board-done">
            {m.board_finished({ finished: props.finished, total: props.total })}
          </p>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
