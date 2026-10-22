import { expect, test } from "vitest";
import { classError, parsePort } from "./forms";

test("parsePort accepts whole numbers from 1 to 65535", () => {
  expect(parsePort("8080")).toBe(8080);
  expect(parsePort(" 80 ")).toBe(80);
  expect(parsePort("1")).toBe(1);
  expect(parsePort("65535")).toBe(65535);
});

test("parsePort refuses anything else", () => {
  for (const bad of ["", "0", "65536", "80.5", "8o80", "-1", "1e3"]) {
    expect(parsePort(bad), bad).toBeNull();
  }
});

test("classError wants a class name of at most 60 characters", () => {
  expect(classError({ name: "  ", students: [] })).toEqual({ field: "name" });
  expect(classError({ name: "Б".repeat(61), students: [] })).toEqual({
    field: "name",
  });
  expect(classError({ name: "7-Б", students: [] })).toBeNull();
});

test("classError names the first student name over 60 characters", () => {
  const long = `${"Коваль ".repeat(9)}Дмитро`;
  expect(
    classError({ name: "7-Б", students: ["Бойко Андрій", long, long] }),
  ).toEqual({ field: "student", index: 1 });
  expect(
    classError({ name: "7-Б", students: ["Бойко Андрій", "Ґудзь Ія"] }),
  ).toBeNull();
});
