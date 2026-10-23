import { useSyncExternalStore } from "react";
import type { Image } from "./generated/testfmt";
import type { StudentQuestion, StudentTest } from "./generated/wire";

/*
 * Where a media name is fetched from depends on the app: the teacher app
 * reads the teacher API, and the student app reads a blob it preloaded and
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

interface Picture {
  content?: unknown;
  image?: Image;
}

/** A question as the server sends it, with the fields of every type. */
type Question = StudentQuestion & {
  body?: unknown;
  targets?: Picture[];
  image?: Image;
};

/**
 * Returns the media names a test shows, without repeats: those in each
 * question's text and body, in its options and targets, and its own image.
 * The names come from the server's payload, which has already checked them.
 */
export function mediaOf(test: StudentTest): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    const n = node as {
      type?: string;
      attrs?: { src?: string };
      content?: unknown[];
    } | null;
    if ((n?.type === "image" || n?.type === "audio") && n.attrs?.src) {
      found.add(n.attrs.src);
    }
    n?.content?.forEach(walk);
  };
  const picture = (p: Picture): void => {
    walk(p.content);
    if (p.image) found.add(p.image.src);
  };
  for (const q of test.questions as Question[]) {
    walk(q.text);
    walk(q.body);
    q.options.forEach(picture);
    q.targets?.forEach(picture);
    if (q.image) found.add(q.image.src);
  }
  return [...found];
}
