import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Builds the klats binary once for the whole run, without the desktop window,
 * and hands its path to the tests as KLATS_BIN. The binary embeds the web
 * apps, so `make web` must have built them first. The returned teardown
 * deletes it.
 */
export default function globalSetup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "klats-e2e-bin-"));
  const bin = join(dir, "klats");
  execFileSync(
    "go",
    ["build", "-tags", "nodesktop", "-o", bin, "./cmd/klats"],
    { cwd: join(import.meta.dirname, "../.."), stdio: "inherit" },
  );
  process.env.KLATS_BIN = bin;
  return () => rmSync(dir, { recursive: true, force: true });
}
