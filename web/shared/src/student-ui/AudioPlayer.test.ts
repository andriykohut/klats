import { expect, test } from "vitest";
import { formatTime } from "./AudioPlayer";

test("formatTime", () => {
  expect([0, 42, 135, 3600].map(formatTime)).toEqual([
    "0:00",
    "0:42",
    "2:15",
    "60:00",
  ]);
});
