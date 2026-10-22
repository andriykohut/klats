import { m } from "@klats/shared/paraglide/messages.js";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { useSettings } from "./api/queries";
import { useFlags } from "./flags";
import { ClassesPage } from "./pages/ClassesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TestsPage } from "./pages/TestsPage";
import { Banners } from "./ui/Banners";
import { Icon } from "./ui/icons";
import { Toasts } from "./ui/Toasts";
import { TopBar } from "./ui/TopBar";

/**
 * The frame of every page. It remounts when the language changes, because
 * messages are read at render time. A 401 replaces the whole app with one
 * message: the launch-token cookie is gone or stale, and only the desktop
 * app can open a new session.
 */
function Shell() {
  const { unauthorized } = useFlags();
  const { data: settings } = useSettings();
  if (unauthorized) {
    return (
      <div className="t-locked">
        <span className="t-mark t-mark-big" aria-hidden="true">
          <Icon name="check" />
        </span>
        <p>{m.auth_open_from_app()}</p>
      </div>
    );
  }
  return (
    <div className="t-app" key={settings?.language}>
      <TopBar />
      <Banners />
      <main className="t-main">
        <Outlet />
      </main>
      <Toasts />
    </div>
  );
}

/** Stands in for the pages that the builder and live view tasks add. */
function Placeholder() {
  return (
    <div className="t-page">
      <p className="t-placeholder">{m.page_coming()}</p>
    </div>
  );
}

const root = createRootRoute({ component: Shell });

export const testsRoute = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: TestsPage,
});
export const testRoute = createRoute({
  getParentRoute: () => root,
  path: "/tests/$id",
  component: Placeholder,
});
export const classesRoute = createRoute({
  getParentRoute: () => root,
  path: "/classes",
  component: ClassesPage,
});
export const liveRoute = createRoute({
  getParentRoute: () => root,
  path: "/live",
  component: Placeholder,
});
export const assignmentsRoute = createRoute({
  getParentRoute: () => root,
  path: "/assignments",
  component: Placeholder,
});
export const assignmentRoute = createRoute({
  getParentRoute: () => root,
  path: "/assignments/$id",
  component: Placeholder,
});
export const settingsRoute = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: SettingsPage,
});

export const router = createRouter({
  routeTree: root.addChildren([
    testsRoute,
    testRoute,
    classesRoute,
    liveRoute,
    assignmentsRoute,
    assignmentRoute,
    settingsRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
