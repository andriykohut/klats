import { useSyncExternalStore } from "react";
import type { StudentTest } from "./generated/wire";
import { fieldsOf, walkNodes } from "./rich/walk";

/*
 * Where a media name is fetched from depends on the app: the teacher app
 * reads the teacher API, and the student app reads a copy it preloaded and
 * falls back to the network. Each app sets its resolver once; components ask
 * through {@link useMediaURL} and redraw when {@link notifyMedia} says the
 * answer changed.
 */

let resolver = (name: string): string => name;
const listeners = new Set<() => void>();

/** Sets how {@link useMediaURL} turns a media name into a URL. */
export function setMediaResolver(fn: (name: string) => string): void {
  resolver = fn;
  notifyMedia();
}

/** Tells every {@link useMediaURL} user to ask the resolver again. */
export function notifyMedia(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Returns the URL for media `name` as the resolver gives it now. */
export const mediaURL = (name: string): string => resolver(name);

/** Returns the URL for media `name`, and renders again when it changes. */
export function useMediaURL(name: string): string {
  return useSyncExternalStore(subscribe, () => mediaURL(name));
}

/**
 * Returns the media names a test shows, without repeats: those in each
 * question's text and body, in its options and targets, and its own image.
 * The names come from the server's payload, which has already checked them.
 */
export function mediaOf(test: StudentTest): string[] {
  const found = new Set<string>();
  for (const f of fieldsOf(test)) {
    walkNodes(f.content, (n) => {
      if ((n.type === "image" || n.type === "audio") && n.attrs?.src) {
        found.add(n.attrs.src);
      }
    });
    if (f.image) found.add(f.image.src);
  }
  return [...found];
}
