import { defineConfig } from "@playwright/test";

// The site's screenshots of the app, taken by `make site-shots`. The suite's
// config keeps Playwright's default match, *.spec.ts and *.test.ts, so it
// never runs these. The shared global setup builds a dev binary, which never
// checks for updates, so no update notice shows in a capture.
export default defineConfig({
  testDir: "./shots",
  testMatch: "*.shots.ts",
  // A run empties its output folder first; this one is not the suite's.
  outputDir: "test-results/shots",
  globalSetup: "./global-setup.ts",
  retries: 0,
  // A run waits out the server's 15 s offline threshold, in each language.
  timeout: 180_000,
  reporter: "list",
  // The fixtures open their own contexts with their own viewports; Playwright
  // fills in the options they leave out, such as the scale, from here.
  use: {
    browserName: "chromium",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 2,
    // The apps then skip their animations, so no capture catches one midway.
    reducedMotion: "reduce",
  },
});
