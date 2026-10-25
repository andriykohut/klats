import { describe, expect, it } from "vitest";
import { reactAriaUkEnOnly } from "./ariaLocales";

const inAria =
  "/w/node_modules/.pnpm/react-aria@3.53.1/node_modules/react-aria/dist/private/overlays/intlStrings.mjs";
const resolve = (source: string, importer?: string) =>
  reactAriaUkEnOnly.resolveId(source, importer);

describe("reactAriaUkEnOnly", () => {
  it("keeps Ukrainian and English and drops the other languages", () => {
    expect(resolve("../intl/overlays/uk-UA.mjs", inAria)).toBeNull();
    expect(resolve("../intl/overlays/en-US.mjs", inAria)).toBeNull();
    const dropped = resolve("../intl/overlays/ru-RU.mjs", inAria);
    expect(dropped).not.toBeNull();
    expect(reactAriaUkEnOnly.load(dropped as string)).toBe(
      "export default undefined;",
    );
  });

  it("leaves imports from other packages and other file names alone", () => {
    expect(resolve("./de-DE.js", "/w/src/app.ts")).toBeNull();
    expect(resolve("./de-DE.js", undefined)).toBeNull();
    expect(resolve("../overlays/useOverlay.mjs", inAria)).toBeNull();
    expect(reactAriaUkEnOnly.load("/w/src/app.ts")).toBeNull();
  });
});
