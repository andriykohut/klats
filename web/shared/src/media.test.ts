import { expect, test } from "vitest";
import type { StudentTest } from "./generated/wire";
import { mediaOf } from "./media";

const name = (c: string, ext: string) => `${c.repeat(64)}.${ext}`;
const doc = (...content: unknown[]) => ({ type: "doc", content });
const image = (src: string) => ({
  type: "image",
  attrs: { src, w: 10, h: 10 },
});
const audio = (src: string) => ({ type: "audio", attrs: { src } });
const pic = (src: string) => ({ src, w: 1, h: 1 });

test("mediaOf", () => {
  const test: StudentTest = {
    title: "t",
    palette: "teal",
    navigation: "free",
    questions: [
      {
        id: "q1",
        type: "single",
        text: doc(
          { type: "paragraph", content: [image(name("a", "png"))] },
          audio(name("b", "wav")),
        ),
        options: [
          { id: "o1", content: doc(), image: pic(name("c", "jpg")) },
          { id: "o2", content: doc(), image: pic(name("a", "png")) },
          { id: "o3", content: doc() },
        ],
      },
    ],
  };
  expect(mediaOf(test)).toEqual([
    name("a", "png"),
    name("b", "wav"),
    name("c", "jpg"),
  ]);
});
