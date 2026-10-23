import { defineConfig } from "@playwright/test";

// Every test starts its own server on a free port with a fresh data folder
// (see fixtures.ts), so tests run in parallel. A spec that fails once is a
// bug to fix, so nothing retries.
export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // The offline checks wait out the server's 15 s offline threshold.
  timeout: 90_000,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
});
