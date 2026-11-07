import { defineConfig } from "astro/config";

// Keeps Astro from sending its anonymous usage data from any build: make web,
// the release scripts and CI all load this file. Astro reads the variable when
// it records the build, after loading the config, so setting it here works on
// every system. Its one-time telemetry notice comes before the config loads,
// so a fresh machine may still print it; the notice sends nothing.
process.env.ASTRO_TELEMETRY_DISABLED = "1";

export default defineConfig({
  site: "https://andriykohut.github.io",
  base: "/klats",
  i18n: {
    defaultLocale: "uk",
    locales: ["uk", "en"],
    routing: { prefixDefaultLocale: false },
  },
});
