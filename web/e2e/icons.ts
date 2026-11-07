/*
 * Renders the program icon and the .klats file icon from their SVGs in
 * build/icon into the files the installers and the desktop shell take: the
 * Windows .ico, the macOS .icns, PNGs for Linux and the window, and the site's
 * favicon. Run it with `make icons`; it needs macOS for iconutil.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const root = join(import.meta.dirname, "../..");
const dir = join(root, "build/icon");
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 256];
// Apple's iconset file names, each with the pixel size it holds.
const ICONSET: [string, number][] = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

/** Renders svg into a size px PNG, drawn body px wide in its centre. */
async function render(page: Page, svg: string, size: number, body = size) {
  await page.setContent(
    `<style>body{margin:0;padding:${(size - body) / 2}px}svg{display:block;width:${body}px;height:${body}px}</style>${svg}`,
  );
  const png = await page.screenshot({
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  assert.equal(png.readUInt32BE(16), size, "the PNG's width");
  return png;
}

/** Packs PNGs into an .ico: an ICONDIR, one ICONDIRENTRY per PNG, the PNGs. */
function ico(pngs: [number, Buffer][]) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2); // type 1: icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(([size, png], i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size % 256, at); // a width or height of 256 is stored as 0
    head.writeUInt8(size % 256, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map(([, png]) => png)]);
}

const tmp = mkdtempSync(join(tmpdir(), "klats-icons-"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
  });
  // The app icon's thin check blurs at 32 px and below, so those sizes
  // render the thicker-stroked klats-small.svg.
  for (const [name, small] of [
    ["klats", "klats-small"],
    ["klats-file", "klats-file"],
  ]) {
    const pngs: Record<number, Buffer> = {};
    const mac: Record<number, Buffer> = {};
    for (const size of SIZES) {
      const svg = readFileSync(
        join(dir, `${size <= 32 ? small : name}.svg`),
        "utf8",
      );
      pngs[size] = await render(page, svg, size);
      // Apple's icon grid draws the body 824 px wide in a 1024 px canvas, so
      // the icon matches its neighbours in the Dock and Finder.
      mac[size] = await render(page, svg, size, (size * 824) / 1024);
    }
    writeFileSync(
      join(dir, `${name}.ico`),
      ico(ICO_SIZES.map((size) => [size, pngs[size]])),
    );
    const set = join(tmp, `${name}.iconset`);
    mkdirSync(set);
    for (const [file, size] of ICONSET)
      writeFileSync(join(set, file), mac[size]);
    execFileSync("iconutil", [
      "-c",
      "icns",
      "-o",
      join(dir, `${name}.icns`),
      set,
    ]);
    if (name === "klats") {
      writeFileSync(join(dir, "klats-256.png"), pngs[256]);
      writeFileSync(join(root, "internal/desktop/icon.png"), pngs[512]);
    }
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
mkdirSync(join(root, "web/site/public"), { recursive: true });
copyFileSync(join(dir, "klats.svg"), join(root, "web/site/public/favicon.svg"));
