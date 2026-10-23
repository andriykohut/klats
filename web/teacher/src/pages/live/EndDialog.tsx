import { m } from "@klats/shared/paraglide/messages.js";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Popover,
} from "react-aria-components";
import { busy, useEndSitting } from "../../api/queries";

/**
 * «Завершити тест» and the question it opens under itself: «Завершити тест
 * для всіх?» with how many students are still `writing`. Confirming ends the
 * sitting for everyone and opens the assignment's results.
 */
export function EndDialog({
  writing,
  assignmentId,
}: {
  writing: number;
  assignmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const end = useEndSitting();
  const navigate = useNavigate();
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button className="t-btn" data-variant="primary">
        {m.live_end()}
      </Button>
      <Popover placement="bottom end" offset={10} className="l-end">
        <Dialog role="alertdialog" className="l-end-dialog">
          <Heading slot="title">{m.end_title()}</Heading>
          <p>{writing > 0 ? m.end_text({ count: writing }) : m.end_none()}</p>
          <div className="l-end-actions">
            <Button
              className="t-btn"
              data-variant="danger"
              isPending={end.isPending}
              onPress={() => {
                if (busy("endSitting")) return;
                // mutateAsync settles even once the ended live view has
                // unmounted this dialog; the query cache reports a failure.
                end.mutateAsync().then(
                  () =>
                    navigate({
                      to: "/assignments/$id",
                      params: { id: assignmentId },
                    }),
                  () => {},
                );
              }}
            >
              {m.end_confirm()}
            </Button>
            <Button slot="close" className="t-btn" data-variant="quiet">
              {m.action_cancel()}
            </Button>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
