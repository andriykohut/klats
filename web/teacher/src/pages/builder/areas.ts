import type { Area, Point } from "@klats/shared/generated/testfmt.ts";
import { newId } from "./model";

/*
 * The geometry of hotspot areas and label points. Every number is a fraction
 * of the picture, between 0 and 1 as internal/testfmt requires, and an area's
 * box stays inside the picture. X, Y is the top-left corner of a W by H box;
 * a "rect" is the box and an "ellipse" is the one inscribed in it, as
 * internal/grading reads them.
 */

/** The smallest width or height of an area, as a fraction of the picture. */
export const MIN_AREA = 0.02;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// Rounding keeps repeated steps from drifting off the 0.0001 grid.
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Returns a new area of `shape` spanning the drag from `a` to `b` in either
 * direction. The box is cut to the picture and is at least {@link MIN_AREA}
 * wide and high; a box that would then leave the picture slides back in.
 */
export function areaFromDrag(
  a: Point,
  b: Point,
  shape: "rect" | "ellipse",
): Area {
  const x0 = clamp(Math.min(a.x, b.x), 0, 1);
  const y0 = clamp(Math.min(a.y, b.y), 0, 1);
  const w = Math.max(clamp(Math.max(a.x, b.x), 0, 1) - x0, MIN_AREA);
  const h = Math.max(clamp(Math.max(a.y, b.y), 0, 1) - y0, MIN_AREA);
  return {
    id: newId(),
    shape,
    x: Math.min(x0, 1 - w),
    y: Math.min(y0, 1 - h),
    w,
    h,
  };
}

/** Returns `area` shifted by (`dx`, `dy`), stopped at the picture's edges. */
export function moveArea(area: Area, dx: number, dy: number): Area {
  return {
    ...area,
    x: clamp(area.x + dx, 0, 1 - area.w),
    y: clamp(area.y + dy, 0, 1 - area.h),
  };
}

/**
 * Returns `area` with one of its numbers set to `value`, cut to what keeps
 * the box inside the picture: a position to 0 up to what leaves room for the
 * size, a size to {@link MIN_AREA} up to what is left of the picture.
 */
export function setAreaField(
  area: Area,
  field: "x" | "y" | "w" | "h",
  value: number,
): Area {
  const room = {
    x: [0, 1 - area.w],
    y: [0, 1 - area.h],
    w: [MIN_AREA, 1 - area.x],
    h: [MIN_AREA, 1 - area.y],
  }[field];
  return { ...area, [field]: clamp(value, room[0], room[1]) };
}

/** Returns `p` shifted by (`dx`, `dy`), kept within 0 to 1. */
export function movePoint(p: Point, dx: number, dy: number): Point {
  return {
    x: clamp(round(p.x + dx), 0, 1),
    y: clamp(round(p.y + dy), 0, 1),
  };
}
