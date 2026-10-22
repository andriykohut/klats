/**
 * The colour palettes a teacher picks per test. Each one is a full set of
 * precomputed hex colours, because the student floor (see browsers.ts) has no
 * color-mix() to derive shades from CSS variables.
 */

export type PaletteId = "teal" | "grape" | "coral" | "lavender" | "classic";

/**
 * Palette colours. `field` is the page around the white sheet; `sel` fills a
 * selected answer tile; `accent` fills progress, the grade ring and the main
 * button, with `ink` text on it; `onField` and `onFieldSoft` are text on the
 * field; `track` and `trackCurrent` are unanswered and current progress
 * segments; `focus` is the focus ring, visible on white and on the field.
 */
export interface Palette {
  field: string;
  sel: string;
  selDark: string;
  ink: string;
  muted: string;
  tile: string;
  tileBorder: string;
  tileShadow: string;
  soft: string;
  accent: string;
  accentDark: string;
  onField: string;
  onFieldSoft: string;
  track: string;
  trackCurrent: string;
  focus: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  teal: {
    field: "#0C6B66",
    sel: "#0C6B66",
    selDark: "#07504C",
    ink: "#0F2A2A",
    muted: "#587170",
    tile: "#EFF7F6",
    tileBorder: "#D5ECE9",
    tileShadow: "#BFDFDB",
    soft: "#E2F1EF",
    accent: "#FF9A3D",
    accentDark: "#D5731C",
    onField: "#FFFFFF",
    onFieldSoft: "#CADEDD",
    track: "#0A5652",
    trackCurrent: "#9EC4C2",
    focus: "#061212",
  },
  grape: {
    field: "#5A3FD6",
    sel: "#5A3FD6",
    selDark: "#3F2AA8",
    ink: "#1D1538",
    muted: "#6F6890",
    tile: "#F6F3FF",
    tileBorder: "#E6E0FB",
    tileShadow: "#D7CFF6",
    soft: "#F0EBFF",
    accent: "#FFA987",
    accentDark: "#DE7B57",
    onField: "#FFFFFF",
    onFieldSoft: "#DBD5F6",
    track: "#4832AB",
    trackCurrent: "#BDB2EF",
    focus: "#07050D",
  },
  coral: {
    field: "#1F2A4A",
    sel: "#1F2A4A",
    selDark: "#111A33",
    ink: "#141A2E",
    muted: "#646B80",
    tile: "#F3F4F8",
    tileBorder: "#E1E4EE",
    tileShadow: "#CFD4E2",
    soft: "#ECEEF4",
    accent: "#FF7062",
    accentDark: "#D44A3D",
    onField: "#FFFFFF",
    onFieldSoft: "#CED0D7",
    track: "#3A4460",
    trackCurrent: "#A5AAB7",
    focus: "#D44A3D",
  },
  lavender: {
    field: "#E9E4FF",
    sel: "#5A3FD6",
    selDark: "#3F2AA8",
    ink: "#1D1538",
    muted: "#6F6890",
    tile: "#F7F5FF",
    tileBorder: "#E6E0FB",
    tileShadow: "#D7CFF6",
    soft: "#F0EBFF",
    accent: "#FF8A6B",
    accentDark: "#D9634A",
    onField: "#1D1538",
    onFieldSoft: "#5E5687",
    track: "#5C5576",
    trackCurrent: "#1D1538",
    focus: "#1D1538",
  },
  classic: {
    field: "#463EE9",
    sel: "#463EE9",
    selDark: "#2A23BD",
    ink: "#17153B",
    muted: "#6C6A92",
    tile: "#F4F4FF",
    tileBorder: "#E2E1FA",
    tileShadow: "#D3D1F5",
    soft: "#EEEDFF",
    accent: "#FFC233",
    accentDark: "#D99A00",
    onField: "#FFFFFF",
    onFieldSoft: "#D6D5FA",
    track: "#3832BA",
    trackCurrent: "#B5B2F6",
    focus: "#060610",
  },
};

/** Sets each palette colour on `el` as a `--k-<kebab-name>` CSS variable. */
export function applyPalette(el: HTMLElement, id: PaletteId): void {
  for (const [name, value] of Object.entries(PALETTES[id])) {
    el.style.setProperty(
      `--k-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      value,
    );
  }
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Returns the WCAG 2 contrast ratio of two `#RRGGBB` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
