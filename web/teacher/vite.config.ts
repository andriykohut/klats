import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server forwards /api to a running `klats -dev`: set
// KLATS_TEACHER_API to the teacher URL it prints, token included. The proxy
// sends the token as a bearer header and poses as the teacher origin, which
// the API's Origin and Host checks require.
const teacher = new URL(process.env.KLATS_TEACHER_API ?? "http://127.0.0.1:0/");

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  // The app loads from this computer, never over the network, so its size
  // is no concern and the minified-size warning only adds noise.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    proxy: {
      "/api": {
        target: teacher.origin,
        changeOrigin: true,
        headers: {
          origin: teacher.origin,
          authorization: `Bearer ${teacher.searchParams.get("t") ?? ""}`,
        },
      },
    },
  },
});
