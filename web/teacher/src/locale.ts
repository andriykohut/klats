import { m } from "@klats/shared/paraglide/messages.js";
import { isLocale, setLocale } from "@klats/shared/paraglide/runtime.js";

/** Switches the UI to `lang` ("uk" or "en"); any other value is ignored. */
export function applyLocale(lang: string): void {
  if (!isLocale(lang)) return;
  setLocale(lang, { reload: false });
  document.documentElement.lang = lang;
  document.title = m.app_name();
}
