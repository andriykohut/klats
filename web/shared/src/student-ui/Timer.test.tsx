import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Timer } from "./Timer";

/** The time the timer shows for `ms` left, and whether it is marked low. */
function shown(ms: number) {
  const html = renderToStaticMarkup(<Timer remainingMs={ms} />);
  return {
    text: html.match(/<\/svg>([^<]*)/)?.[1],
    low: html.includes("data-low"),
  };
}

test("rounds up to the second, as m:ss below an hour and h:mm:ss from one up", () => {
  expect(shown(119_001)).toEqual({ text: "2:00", low: false });
  expect(shown(65_000)).toEqual({ text: "1:05", low: false });
  expect(shown(3_599_001)).toEqual({ text: "1:00:00", low: false });
  expect(shown(5_405_000)).toEqual({ text: "1:30:05", low: false });
});

test("is low under a minute and never goes below zero", () => {
  expect(shown(59_001)).toEqual({ text: "1:00", low: false });
  expect(shown(59_000)).toEqual({ text: "0:59", low: true });
  expect(shown(0)).toEqual({ text: "0:00", low: true });
  expect(shown(-3_000)).toEqual({ text: "0:00", low: true });
});

test("announces nothing for a mark already passed when it mounts", () => {
  const html = renderToStaticMarkup(<Timer remainingMs={30_000} />);
  expect(html).toMatch(/role="status"><\/p>/);
});
