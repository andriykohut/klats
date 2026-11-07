import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://andriykohut.github.io",
  base: "/klats",
  i18n: {
    defaultLocale: "uk",
    locales: ["uk", "en"],
    routing: { prefixDefaultLocale: false },
  },
});
