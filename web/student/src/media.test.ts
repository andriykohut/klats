import type { StudentTest } from "@klats/shared/generated/wire.ts";
import { mediaURL } from "@klats/shared/media.ts";
import { afterEach, expect, test, vi } from "vitest";
import { preloadMedia, releaseMedia, retryMedia } from "./media";

const name = (c: string) => `${c.repeat(64)}.png`;
const doc = { type: "doc", content: [] };
const fiveImages: StudentTest = {
  title: "t",
  palette: "teal",
  questions: [
    {
      id: "q",
      type: "single",
      text: doc,
      options: ["a", "b", "c", "d", "e"].map((c) => ({
        id: c,
        content: doc,
        image: { src: name(c), w: 1, h: 1 },
      })),
    },
  ],
};

afterEach(() => {
  releaseMedia();
  vi.unstubAllGlobals();
});

test("preload fetches two at a time and retries failures", async () => {
  let inflight = 0;
  let peak = 0;
  let offline = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      if (offline && url.includes(name("c"))) throw new TypeError("offline");
      return new Response(new Blob(["x"]));
    }),
  );

  preloadMedia(fiveImages);
  await vi.waitFor(() => expect(mediaURL(name("e"))).toMatch(/^blob:/));
  expect(peak).toBe(2);
  expect(mediaURL(name("c"))).toBe(`/api/media/${name("c")}`);

  offline = false;
  retryMedia();
  await vi.waitFor(() => expect(mediaURL(name("c"))).toMatch(/^blob:/));

  releaseMedia();
  expect(mediaURL(name("c"))).toBe(`/api/media/${name("c")}`);
});
