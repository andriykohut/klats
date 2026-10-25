import { expect, test } from "vitest";
import {
  areaFromDrag,
  MIN_AREA,
  moveArea,
  movePoint,
  setAreaField,
} from "./areas";

const near = (n: number) => expect.closeTo(n, 9);
const area = { id: "a", shape: "rect", x: 0.2, y: 0.3, w: 0.4, h: 0.5 };

test("areaFromDrag", () => {
  expect(
    areaFromDrag({ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.2 }, "rect"),
  ).toMatchObject({
    shape: "rect",
    x: near(0.3),
    y: near(0.2),
    w: near(0.2),
    h: near(0.3),
  });
  expect(
    areaFromDrag({ x: 0.9, y: 0.9 }, { x: 1.4, y: 0.9 }, "ellipse"),
  ).toMatchObject({
    shape: "ellipse",
    x: near(0.9),
    w: near(0.1),
    h: near(0.02),
  });
});

test("areaFromDrag keeps a dragged-out box inside the image and at least the minimum size", () => {
  const out = areaFromDrag({ x: -0.5, y: 0.99 }, { x: 0.01, y: 2 }, "rect");
  expect(out).toMatchObject({ x: 0, w: near(MIN_AREA) });
  expect(out.y + out.h).toBeLessThanOrEqual(1 + 1e-9);
  expect(out.h).toBeGreaterThanOrEqual(MIN_AREA - 1e-9);
  const corner = areaFromDrag({ x: 1, y: 1 }, { x: 1, y: 1 }, "rect");
  expect(corner.x + corner.w).toBeLessThanOrEqual(1 + 1e-9);
  expect(corner.y + corner.h).toBeLessThanOrEqual(1 + 1e-9);
  expect(corner.w).toBeCloseTo(MIN_AREA, 9);
  const whole = () => areaFromDrag({ x: 0, y: 0 }, { x: 1, y: 1 }, "rect");
  expect(whole().id).not.toBe(whole().id);
});

test("moveArea shifts the box and stops it at the image's edges", () => {
  expect(moveArea(area, 0.1, -0.1)).toMatchObject({
    x: near(0.3),
    y: near(0.2),
    w: 0.4,
    h: 0.5,
  });
  expect(moveArea(area, 5, 5)).toMatchObject({ x: near(0.6), y: near(0.5) });
  expect(moveArea(area, -5, -5)).toMatchObject({ x: 0, y: 0 });
});

test("setAreaField clamps each field so the box stays inside the image", () => {
  expect(setAreaField(area, "x", 0.9)).toMatchObject({ x: near(0.6), w: 0.4 });
  expect(setAreaField(area, "y", -1).y).toBe(0);
  expect(setAreaField(area, "w", 2).w).toBeCloseTo(0.8, 9);
  expect(setAreaField(area, "h", 0).h).toBe(MIN_AREA);
  expect(setAreaField(area, "w", 0.25)).toMatchObject({ x: 0.2, w: 0.25 });
});

test("movePoint steps a point and keeps it within 0 to 1", () => {
  expect(movePoint({ x: 0.5, y: 0.5 }, 0.01, -0.01)).toEqual({
    x: 0.51,
    y: 0.49,
  });
  expect(movePoint({ x: 0.995, y: 0.003 }, 0.01, -0.01)).toEqual({
    x: 1,
    y: 0,
  });
  let p = { x: 0.5, y: 0.5 };
  for (let i = 0; i < 30; i++) p = movePoint(p, 0.01, 0);
  expect(p.x).toBe(0.8);
});

test("areaFromDrag cuts both corners to the picture, whichever way the drag goes", () => {
  const out = areaFromDrag({ x: 1.2, y: -0.3 }, { x: -0.1, y: 1.5 }, "ellipse");
  expect(out).toMatchObject({ x: 0, y: 0, w: near(1), h: near(1) });
});

test("movePoint without a step cuts a point just outside the picture back to its edge", () => {
  expect(movePoint({ x: -0.0004, y: 1.0007 }, 0, 0)).toEqual({ x: 0, y: 1 });
});
