import { expect, test } from "vitest";
import { base32, normalizeAddress } from "./api";

test("base32 is lowercase RFC 4648 without padding", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  expect(base32(bytes(""))).toBe("");
  expect(base32(bytes("f"))).toBe("my");
  expect(base32(bytes("foobar"))).toBe("mzxw6ytboi");
  expect(base32(new Uint8Array(16).fill(255))).toBe(`${"7".repeat(25)}4`);
});

test("normalizeAddress accepts an address, a port and an http:// prefix", () => {
  expect(normalizeAddress("10.0.0.5")).toBe("http://10.0.0.5");
  expect(normalizeAddress("10.0.0.5:8080")).toBe("http://10.0.0.5:8080");
  expect(normalizeAddress("http://10.0.0.5:8080")).toBe("http://10.0.0.5:8080");
  expect(normalizeAddress("  HTTP://10.0.0.5:8080/ ")).toBe(
    "http://10.0.0.5:8080",
  );
  expect(normalizeAddress("Teacher-PC")).toBe("http://teacher-pc");
  expect(normalizeAddress("klats.school.local:65535")).toBe(
    "http://klats.school.local:65535",
  );
  expect(normalizeAddress("192.168.1.10:1")).toBe("http://192.168.1.10:1");
});

test("normalizeAddress refuses anything else", () => {
  for (const bad of [
    "",
    "   ",
    "10.0.0.256",
    "10.0.0",
    "10.0.0.5.6",
    "10.0.0.5:0",
    "10.0.0.5:65536",
    "10.0.0.5:",
    "10.0.0.5:80a",
    "10.0.0.5/test",
    "http://10.0.0.5:8080/api",
    "https://10.0.0.5",
    "10.0. 0.5",
    "teacher pc",
    "-teacher.local",
    "teacher_pc",
    "[fe80::1]:8080",
  ]) {
    expect(normalizeAddress(bad), bad).toBeNull();
  }
});
