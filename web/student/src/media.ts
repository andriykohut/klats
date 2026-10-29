import type { StudentTest } from "@klats/shared/generated/wire.ts";
import { mediaOf, notifyMedia, setMediaResolver } from "@klats/shared/media.ts";
import { apiBase } from "./api";

/*
 * The test's pictures and audio are fetched as soon as the test loads and
 * kept in memory as blob URLs, or data: URLs for SVG, so they show after the
 * network drops. A file that fails stays missing, and the app shows the
 * teacher's address for it until {@link retryMedia} gets it.
 */

const PARALLEL = 2;
const TIMEOUT_MS = 60_000;

/** The blob or data: URL of each name loaded so far. */
const blobs = new Map<string, string>();
let names: string[] = [];
/** Names queued or in flight, so none is fetched twice at once. */
const pending = new Set<string>();
let queue: string[] = [];
let running = 0;
/** Bumped by {@link releaseMedia}, so a fetch started before it is dropped. */
let generation = 0;

setMediaResolver((name) => blobs.get(name) ?? `${apiBase()}/api/media/${name}`);

/**
 * Starts fetching every file `test` shows, two at a time, and calls
 * `notifyMedia` as each arrives. It replaces any earlier test's files.
 */
export function preloadMedia(test: StudentTest): void {
  releaseMedia();
  names = mediaOf(test);
  retryMedia();
}

/** Fetches again every file of the test that has not arrived. */
export function retryMedia(): void {
  for (const name of names) {
    if (!blobs.has(name) && !pending.has(name)) {
      pending.add(name);
      queue.push(name);
    }
  }
  pump();
}

/**
 * Drops the files and revokes their blob URLs, such as when the session ends.
 * Revoking a data: URL does nothing.
 */
export function releaseMedia(): void {
  generation++;
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
  pending.clear();
  queue = [];
  names = [];
  running = 0;
  notifyMedia();
}

function pump(): void {
  while (running < PARALLEL && queue.length > 0) {
    void load(queue.shift() as string);
  }
}

async function load(name: string): Promise<void> {
  const mine = generation;
  running++;
  try {
    const res = await fetch(`${apiBase()}/api/media/${name}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    // A blob URL opened in a tab of its own, as «Open image in new tab» does,
    // runs an SVG's scripts in this page's origin; a data: URL's origin is
    // opaque.
    const url =
      blob.type === "image/svg+xml"
        ? await dataURL(blob)
        : URL.createObjectURL(blob);
    if (mine === generation) {
      blobs.set(name, url);
      notifyMedia();
    } else URL.revokeObjectURL(url);
  } catch {
    // The file stays missing; the next retryMedia tries it again.
  } finally {
    if (mine === generation) {
      running--;
      pending.delete(name);
      pump();
    }
  }
}

/** Resolves to `blob` as a data: URL. */
function dataURL(blob: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as string);
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(blob);
  });
}
