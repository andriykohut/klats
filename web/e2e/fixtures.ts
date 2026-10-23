/*
 * The end-to-end harness. Each test gets its own `klats -dev` on a free port
 * with a fresh data folder, so tests run in parallel without sharing a
 * sitting. A test seeds it through the teacher API with the launch token the
 * server prints, then drives student computers and the teacher app, each in
 * a browser context of its own. Copy comes from the Paraglide messages (base
 * locale uk), so the specs follow the app's wording.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Question } from "@klats/shared/generated/testfmt.ts";
import type {
  AssignmentResults,
  LiveSnapshot,
  SittingInfo,
} from "@klats/shared/generated/wire.ts";
import { m } from "@klats/shared/paraglide/messages.js";
import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";

export { expect, m };

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/**
 * Returns a choice question worth `points`. Options starting with `*` are
 * correct (the star is dropped); more than one correct option makes it
 * multiple choice with partial credit.
 */
export function question(
  id: string,
  text: string,
  options: string[],
  points = 1,
): Question & { title: string } {
  const multi = options.filter((o) => o.startsWith("*")).length > 1;
  return {
    id,
    title: text,
    type: multi ? "multi" : "single",
    text: doc(text),
    points,
    shuffleOptions: false,
    partial: multi,
    options: options.map((o, i) => ({
      id: `${id}o${i}`,
      content: doc(o.replace(/^\*/, "")),
      correct: o.startsWith("*"),
    })),
  };
}

/** Class 7-Б, in the order the server lists it. */
export const CLASS = [
  "Бондаренко Олена",
  "Гнатюк Ігор",
  "Коваль Максим",
  "Олійник Дарина",
];

/** The default test: three questions, 4 points, the second one multi. */
export const TEST = [
  question("q1", "Скільки біт в одному байті?", ["4", "*8", "16"]),
  question(
    "q2",
    "Які з цих пристроїв є пристроями введення?",
    ["*Клавіатура", "*Мишка", "Монітор"],
    2,
  ),
  question("q3", "Яка з цих програм є браузером?", [
    "*Firefox",
    "Excel",
    "Paint",
  ]),
];

export type TestQuestion = ReturnType<typeof question>;

export interface Klats {
  /** The student app's address. */
  student: string;
  /** Makes class 7-Б and a test of `questions`, and starts a sitting of it. */
  start(questions?: TestQuestion[]): Promise<SittingInfo>;
  /** Stores `bytes` in the media store and returns its media name. */
  upload(bytes: Buffer): Promise<string>;
  /** The teacher's live snapshot. */
  live(): Promise<LiveSnapshot>;
  /** The teacher's results of the assignment `id`. */
  results(id: string): Promise<AssignmentResults>;
  /** Renames the computer the student `name` writes on. */
  rename(name: string, label: string): Promise<void>;
  /** A student computer: a 1024×768 page in a browser context of its own. */
  computer(): Promise<Page>;
  /** The teacher app at `path`: a 1366×768 page in a context of its own. */
  teacher(path?: string): Promise<Page>;
}

export const test = base.extend<{ klats: Klats }>({
  klats: async ({ browser }, use, testInfo) => {
    const bin = process.env.KLATS_BIN;
    if (!bin) throw new Error("KLATS_BIN is unset; run through the config");
    const data = mkdtempSync(join(tmpdir(), "klats-e2e-"));
    const proc = spawn(bin, ["-dev", "-data", data, "-port", "0"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    proc.stderr.on("data", (b) => {
      log += b;
    });
    const exited = once(proc, "exit");
    const urls = new Map<string, string>();
    // A server that hangs before its teacher line is killed, which ends stdout.
    const hung = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    for await (const line of createInterface({ input: proc.stdout })) {
      const [key, url] = line.split(" ");
      urls.set(key, url);
      if (key === "teacher") break;
    }
    clearTimeout(hung);
    const printed = urls.get("teacher");
    if (!printed) {
      proc.kill("SIGKILL");
      await exited;
      rmSync(data, { recursive: true, force: true });
      throw new Error(`klats did not start:\n${log}`);
    }
    const teacherURL = new URL(printed);
    const token = teacherURL.searchParams.get("t");

    const api = async <T>(method: string, path: string, body?: unknown) => {
      const res = await fetch(teacherURL.origin + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
      return (text ? JSON.parse(text) : undefined) as T;
    };
    const live = () => api<LiveSnapshot>("GET", "/api/sittings/current");
    const contexts: BrowserContext[] = [];
    const open = async (width: number, height: number) => {
      const context = await browser.newContext({ viewport: { width, height } });
      contexts.push(context);
      return context.newPage();
    };

    await use({
      student: urls.get("student") ?? "",
      live,
      async upload(bytes) {
        const res = await fetch(`${teacherURL.origin}/api/media`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: new Uint8Array(bytes),
        });
        if (!res.ok) throw new Error(`POST /api/media: ${res.status}`);
        return ((await res.json()) as { name: string }).name;
      },
      results: (id) =>
        api<AssignmentResults>("GET", `/api/assignments/${id}/results`),
      async start(questions = TEST) {
        const cls = await api<{ id: string }>("POST", "/api/classes", {
          id: "",
          name: "7-Б",
          students: CLASS.map((name) => ({ id: "", name })),
        });
        const title = "Інформатика";
        const { id } = await api<{ id: string }>("POST", "/api/tests", {
          title,
        });
        const plain = questions.map(({ title: _, ...q }) => q);
        await api("PUT", `/api/tests/${id}`, {
          id,
          version: 1,
          title,
          palette: "teal",
          questions: plain,
        });
        return api<SittingInfo>("POST", "/api/sittings", {
          testId: id,
          classId: cls.id,
        });
      },
      async rename(name, label) {
        const row = (await live()).rows.find((r) => r.name === name);
        if (!row) throw new Error(`${name} is not in the sitting`);
        await api("PUT", `/api/devices/${row.deviceToken}`, { label });
      },
      computer: () => open(1024, 768),
      async teacher(path = "/live") {
        const page = await open(1366, 768);
        await page.goto(teacherURL.href); // sets the launch-token cookie
        await page.goto(teacherURL.origin + path);
        return page;
      },
    });

    for (const context of contexts) await context.close();
    proc.kill("SIGTERM");
    await exited;
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("server.log", { body: log });
    }
    rmSync(data, { recursive: true, force: true });
  },
});

/** Opens the student app with the join code, picks `name` and starts. */
export async function joinAs(
  page: Page,
  klats: Klats,
  code: string,
  name: string,
) {
  await page.goto(`${klats.student}/?code=${code}`);
  await page.getByText(name, { exact: true }).click();
  await page.getByRole("button", { name: m.pick_start() }).click();
  await expect(page.getByRole("button", { name: m.test_skip() })).toBeVisible();
}

/** The answer tiles of question `q` on the student's sheet. */
export const answers = (page: Page, q: TestQuestion) =>
  page.getByRole(q.type === "multi" ? "group" : "radiogroup", {
    name: q.title,
  });

/** Picks the options labelled `labels` of `q`, by clicking their tiles. */
export async function pick(page: Page, q: TestQuestion, ...labels: string[]) {
  const tiles = answers(page, q);
  const role = q.type === "multi" ? "checkbox" : "radio";
  for (const label of labels) {
    await tiles.getByText(label, { exact: true }).click();
    await expect(tiles.getByRole(role, { name: label })).toBeChecked();
  }
}

/** Waits until the teacher's live snapshot satisfies `ok`. */
export async function until(
  klats: Klats,
  ok: (live: LiveSnapshot) => boolean,
  timeout = 10_000,
) {
  await expect.poll(async () => ok(await klats.live()), { timeout }).toBe(true);
}
