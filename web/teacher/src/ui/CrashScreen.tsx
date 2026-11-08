import { m } from "@klats/shared/paraglide/messages.js";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "react-aria-components";

/**
 * Takes the place of a page that threw while rendering: says something went
 * wrong, with a button that reloads the app and, on any page but the library,
 * one that opens the library.
 */
export function CrashScreen() {
  const navigate = useNavigate();
  return (
    <div className="t-page">
      <div className="t-empty">
        <h1>{m.crash_title()}</h1>
        <p>{m.crash_teacher_text()}</p>
        <Button
          className="t-btn"
          data-variant="quiet"
          onPress={() => location.reload()}
        >
          {m.crash_reload()}
        </Button>
        {location.pathname !== "/" && (
          <Button
            className="t-btn"
            data-variant="quiet"
            onPress={() => navigate({ to: "/" })}
          >
            {m.crash_to_tests()}
          </Button>
        )}
      </div>
    </div>
  );
}
