import type { ImageMetadata } from "astro";
import type { Lang } from "./i18n";

const files = import.meta.glob<{ default: ImageMetadata }>(
  "./assets/shots/*/*.png",
  { eager: true },
);

/**
 * Returns the screenshot saved as src/assets/shots/<lang>/<file>.png, or
 * undefined when there is no such file.
 */
export function findShot(lang: Lang, file: string): ImageMetadata | undefined {
  return files[`./assets/shots/${lang}/${file}.png`]?.default;
}
