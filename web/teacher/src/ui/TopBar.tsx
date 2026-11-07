import type { AboutInfo } from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import { Link } from "@tanstack/react-router";
import {
  Button,
  Dialog,
  DialogTrigger,
  Heading,
  Popover,
} from "react-aria-components";
import { useAbout, useLive, useOpenLink } from "../api/queries";
import { Icon } from "./icons";

/**
 * The teal bar over every page: the brand, the four sections, and, while a
 * sitting runs, a chip with its test and join code that opens the live view.
 * Once the live view has loaded with no sitting running, a newer release shows
 * as {@link UpdatePill} in the chip's place.
 */
export function TopBar() {
  const { data: live } = useLive();
  const { data: about } = useAbout();
  const sitting = live && !live.sitting.ended ? live.sitting : null;
  return (
    <header className="t-bar">
      <Link to="/" className="t-brand">
        <span className="t-mark">
          <Icon name="check" />
        </span>
        {m.app_name()}
      </Link>
      <nav className="t-nav" aria-label={m.nav_label()}>
        <Link to="/" activeOptions={{ exact: true }}>
          {m.nav_tests()}
        </Link>
        <Link to="/classes/{-$id}" params={{ id: undefined }}>
          {m.nav_classes()}
        </Link>
        <Link to="/assignments">{m.nav_results()}</Link>
        <Link to="/settings">{m.nav_settings()}</Link>
      </nav>
      {sitting ? (
        <Link to="/live" className="t-live-chip">
          <span className="t-live-dot" aria-hidden="true" />
          <span className="t-live-text">
            <small>{m.live_chip_running()}</small>
            <b>{sitting.testTitle}</b>
          </span>
          <span className="t-live-code">
            <small>{m.live_chip_code()}</small>
            <strong>{sitting.code}</strong>
          </span>
        </Link>
      ) : (
        live !== undefined && about?.latest && <UpdatePill about={about} />
      )}
    </header>
  );
}

/**
 * «Нова версія» and the card it opens, which names the newer release and the
 * running version. «Завантажити» opens the Klats website's download section
 * and «Що нового» the release notes, both in the system browser.
 */
function UpdatePill({ about }: { about: AboutInfo }) {
  const open = useOpenLink();
  return (
    <DialogTrigger>
      <Button className="t-update-pill">
        <span className="t-update-dot" aria-hidden="true" />
        {m.update_pill()}
      </Button>
      <Popover placement="bottom end" offset={10} className="t-update-card">
        <Dialog className="t-update-dialog">
          <Heading slot="title">
            {m.update_title({ latest: about.latest })}
          </Heading>
          <p>{m.update_text({ current: about.version })}</p>
          <div className="t-update-actions">
            <Button
              className="t-btn"
              data-variant="primary"
              onPress={() => open.mutate("download")}
            >
              {m.update_download()}
            </Button>
            <Button
              className="t-btn"
              data-variant="quiet"
              onPress={() => open.mutate("notes")}
            >
              {m.update_notes()}
            </Button>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
