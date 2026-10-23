import { m } from "@klats/shared/paraglide/messages.js";
import { Link } from "@tanstack/react-router";
import { Button } from "react-aria-components";
import { useNetwork } from "../api/queries";
import { setFlags, useFlags } from "../flags";
import { Icon } from "./icons";

/**
 * The notices every page shows under the top bar: the student server could
 * not take its port, and the students' address changed. The first lasts until
 * a restart fixes it; the teacher dismisses the second once the new address
 * is on the board.
 */
export function Banners() {
  const { data: net } = useNetwork();
  const { addressChanged, portSaved } = useFlags();
  return (
    <>
      {net?.error === "port_busy" && (
        <div className="t-banner" data-tone="error" role="alert">
          <Icon name="alert" />
          <p>{portBusyText(net.port, portSaved)}</p>
          <Link
            to="/settings"
            hash="port"
            className="t-banner-link"
            onClick={() => setFlags({ focusPort: true })}
          >
            {m.banner_port_change()}
          </Link>
        </div>
      )}
      {addressChanged && net && (
        <div className="t-banner" role="status">
          <Icon name="alert" />
          <p>
            {net.url ? (
              <>
                {m.banner_address_changed()} <b>{net.url}</b>
              </>
            ) : (
              m.network_none()
            )}
          </p>
          <Button
            className="t-icon-btn"
            aria-label={m.action_close()}
            onPress={() => setFlags({ addressChanged: false })}
          >
            <Icon name="close" />
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * What the port-busy notices say. While the student server is down the
 * server reports the saved port, so once the teacher saved another one in
 * this session, the notice asks for a restart instead of calling it busy.
 */
export function portBusyText(port: number, saved: boolean): string {
  return saved ? m.banner_port_restart({ port }) : m.banner_port_busy({ port });
}
