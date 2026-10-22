import { expect, test } from "vitest";
import { contrast, PALETTES } from "./palettes";

test("every palette meets contrast", () => {
  for (const p of Object.values(PALETTES)) {
    expect(contrast(p.ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.muted, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.onField, p.field)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.onFieldSoft, p.field)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", p.sel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.ink, p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.focus, "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(p.focus, p.field)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.accent, p.track)).toBeGreaterThanOrEqual(3);
  }
});
