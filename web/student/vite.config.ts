import { buildTarget, cssTargets } from "@klats/shared/browsers.ts";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server forwards /api to a running `klats -dev`; set KLATS_API to
// the student address it prints when that is not the first free port.
const api = process.env.KLATS_API ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  build: {
    target: buildTarget,
    // `make check` holds the app to 350 KB of gzipped JS, which is what
    // loads over the lab network, so the minified-size warning only adds noise.
    chunkSizeWarningLimit: 1200,
  },
  css: { transformer: "lightningcss", lightningcss: { targets: cssTargets } },
  server: { proxy: { "/api": api } },
});
