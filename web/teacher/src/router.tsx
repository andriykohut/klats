import { m } from "@klats/shared/paraglide/messages.js";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { Fragment } from "react";
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
 * The app root: the 401 gate and the toasts. A 401 replaces the whole app
 * with one message: the launch-token cookie is gone or stale, and only the
 * desktop app can open a new session. Everything below remounts when the
 * language changes, because messages are read at render time.
 */
function Root() {
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
    <Fragment key={settings?.language}>
      <Outlet />
      <Toasts />
    </Fragment>
  );
}

/**
 * The frame of the library, classes, results and settings: the top bar and
 * the banners over the page. A route that brings its own bar, such as the
 * builder or the live view, hangs off the root instead.
 */
function Shell() {
  return (
    <div className="t-app">
      <TopBar />
      <Banners />
      <main className="t-main">
        <Outlet />
      </main>
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

const root = createRootRoute({ component: Root });

const shell = createRoute({
  getParentRoute: () => root,
  id: "shell",
  component: Shell,
});

export const testsRoute = createRoute({
  getParentRoute: () => shell,
  path: "/",
  component: TestsPage,
});
export const testRoute = createRoute({
  getParentRoute: () => shell,
  path: "/tests/$id",
  component: Placeholder,
});
export const classesRoute = createRoute({
  getParentRoute: () => shell,
  path: "/classes",
  component: ClassesPage,
});
export const liveRoute = createRoute({
  getParentRoute: () => shell,
  path: "/live",
  component: Placeholder,
});
export const assignmentsRoute = createRoute({
  getParentRoute: () => shell,
  path: "/assignments",
  component: Placeholder,
});
export const assignmentRoute = createRoute({
  getParentRoute: () => shell,
  path: "/assignments/$id",
  component: Placeholder,
});
export const settingsRoute = createRoute({
  getParentRoute: () => shell,
  path: "/settings",
  component: SettingsPage,
});

export const router = createRouter({
  routeTree: root.addChildren([
    shell.addChildren([
      testsRoute,
      testRoute,
      classesRoute,
      liveRoute,
      assignmentsRoute,
      assignmentRoute,
      settingsRoute,
    ]),
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
