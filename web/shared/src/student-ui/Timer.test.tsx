import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { m } from "../paraglide/messages.js";
import { Timer } from "./Timer";

/**
 * What the timer draws for `ms` left: the time it shows, whether it is marked
 * low, and what its polite region says.
 */
function shown(ms: number) {
  const html = renderToStaticMarkup(<Timer remainingMs={ms} />);
  return {
    text: html.match(/<\/svg>([^<]*)/)?.[1],
    low: html.includes("data-low"),
    said: html.match(/role="status">([^<]*)/)?.[1],
  };
}

test("rounds up to the second, as m:ss below an hour and h:mm:ss from one up", () => {
  expect(shown(119_001)).toMatchObject({ text: "2:00", low: false });
  expect(shown(65_000)).toMatchObject({ text: "1:05", low: false });
  expect(shown(3_599_001)).toMatchObject({ text: "1:00:00", low: false });
  expect(shown(5_405_000)).toMatchObject({ text: "1:30:05", low: false });
});

test("is low under a minute and never goes below zero", () => {
  expect(shown(59_001)).toMatchObject({ text: "1:00", low: false });
  expect(shown(59_000)).toMatchObject({ text: "0:59", low: true });
  expect(shown(0)).toMatchObject({ text: "0:00", low: true });
  expect(shown(-3_000)).toMatchObject({ text: "0:00", low: true });
});

test("announces each mark politely as the time crosses it, then goes quiet", () => {
  expect(shown(301_000).said).toBe("");
  expect(shown(299_000).said).toBe(m.timer_left({ count: 5 }));
  expect(shown(289_000).said).toBe("");
  expect(shown(61_000).said).toBe("");
  expect(shown(59_000).said).toBe(m.timer_left({ count: 1 }));
  expect(shown(49_000).said).toBe("");
});
