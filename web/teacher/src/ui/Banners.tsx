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
  const { addressChanged } = useFlags();
  return (
    <>
      {net?.error === "port_busy" && (
        <div className="t-banner" data-tone="error" role="alert">
          <Icon name="alert" />
          <p>{m.banner_port_busy({ port: net.port })}</p>
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
