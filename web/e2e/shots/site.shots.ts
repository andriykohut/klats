/*
 * The four screens of the app that the site shows, captured from the real
 * app in each language into web/site/src/assets/shots/<lang>/. Six students
 * of class 7-Б take a nine-question test on networks: the live journal is
 * taken with one finished, one offline and the rest part-way through, the
 * results once all have finished. The students answer in Ukrainian, since
 * they join before the teacher app switches language; only the teacher's
 * screens and the test's content follow the capture's language.
 */
import { join } from "node:path";
import type { SittingInfo } from "@klats/shared/generated/wire.ts";
import type { Page } from "@playwright/test";
import {
  CLASS,
  doc,
  expect,
  joinAs,
  m,
  pick,
  question,
  questionOf,
  type TestQuestion,
  test,
  until,
} from "../fixtures";

type Lang = "uk" | "en";

/** A question of the test and how a student answers it. */
interface Item {
  question: TestQuestion;
  /** Gives the right answer, or a wrong one when `right` is false. */
  answer(page: Page, right: boolean): Promise<void>;
}

/** A statement of a true/false question or a row of a grid, on the student's sheet. */
const row = (page: Page, text: string) =>
  page.getByRole("radiogroup", { name: text, exact: true });

/**
 * A choice question; options starting with `*` are right. Its wrong answer
 * is the first wrong option, with the first right one when several are right.
 */
function choice(
  id: string,
  tags: string[],
  text: string,
  options: string[],
  points = 1,
): Item {
  const q = { ...question(id, text, options, points), tags };
  const right = options.filter((o) => o.startsWith("*")).map((o) => o.slice(1));
  const wrong = options.find((o) => !o.startsWith("*")) ?? "";
  const miss = q.type === "multi" ? [right[0], wrong] : [wrong];
  return {
    question: q,
    answer: (page, ok) => pick(page, q, ...(ok ? right : miss)),
  };
}

/**
 * A true/false question; statements starting with `*` are true. Its wrong
 * answer gets the first statement wrong.
 */
function statements(
  id: string,
  tags: string[],
  text: string,
  items: string[],
  points: number,
): Item {
  const plain = items.map((s) => s.replace(/^\*/, ""));
  const q = questionOf("truefalse", id, text, {
    points,
    tags,
    options: items.map((s, i) => ({
      id: `${id}o${i}`,
      content: doc(plain[i]),
      correct: s.startsWith("*"),
    })),
  });
  return {
    question: q,
    async answer(page, ok) {
      for (const [i, s] of items.entries()) {
        const truth = s.startsWith("*") !== (!ok && i === 0);
        await row(page, plain[i])
          .getByText(truth ? m.answer_true() : m.answer_false(), {
            exact: true,
          })
          .click();
      }
    },
  };
}

/**
 * A choice grid of two `columns`; each row gives the index of its right
 * column. Its wrong answer puts the first row in the other column.
 */
function grid(
  id: string,
  tags: string[],
  text: string,
  columns: [string, string],
  rows: [string, number][],
  points: number,
): Item {
  const q = questionOf("grid", id, text, {
    points,
    tags,
    targets: columns.map((c, i) => ({
      id: `${id}c${i}`,
      content: doc(c),
      x: 0,
      y: 0,
    })),
    options: rows.map(([r, c], i) => ({
      id: `${id}o${i}`,
      content: doc(r),
      correct: false,
      target: `${id}c${c}`,
    })),
  });
  return {
    question: q,
    async answer(page, ok) {
      for (const [i, [r, c]] of rows.entries()) {
        const column = !ok && i === 0 ? 1 - c : c;
        await row(page, r).locator(".k-grid-dot").nth(column).click();
      }
    },
  };
}

/** A short or number question, answered by typing `right` or `wrong`. */
function typed(q: TestQuestion, right: string, wrong: string): Item {
  return {
    question: q,
    answer: (page, ok) =>
      page.getByRole("textbox", { name: q.title }).fill(ok ? right : wrong),
  };
}

/** Returns a number question whose answer is exactly `value`. */
const exact = (id: string, tags: string[], text: string, value: number) =>
  questionOf("number", id, text, {
    tags,
    number: { mode: "exact", value, tolerance: 0, min: 0, max: 0 },
  });

/** The same test in each language. */
const TESTS: Record<Lang, { title: string; items: Item[] }> = {
  uk: {
    title: "Інформатика. Мережі",
    items: [
      choice("q1", ["Мережі", "Урок 8"], "Що таке комп’ютерна мережа?", [
        "*Комп’ютери, з’єднані між собою для обміну даними",
        "Програма для перегляду вебсторінок",
        "Набір файлів на одному диску",
      ]),
      choice(
        "q2",
        ["Мережі", "Урок 8"],
        "Які з цих пристроїв є мережевим обладнанням?",
        ["*Маршрутизатор", "*Комутатор", "Сканер", "Монітор"],
        2,
      ),
      grid(
        "q3",
        ["Мережі", "Урок 8"],
        "Яка це мережа: локальна чи глобальна?",
        ["Локальна", "Глобальна"],
        [
          ["Мережа комп’ютерного класу", 0],
          ["Інтернет", 1],
          ["Домашня мережа Wi-Fi", 0],
        ],
        2,
      ),
      choice(
        "q4",
        ["Мережі", "Урок 8"],
        "Усі комп’ютери класу під’єднано до одного комутатора. Як називається така топологія мережі?",
        ["*Зірка", "Кільце", "Шина"],
      ),
      statements(
        "q5",
        ["Урок 8"],
        "Чи правильні ці твердження про IP-адреси?",
        [
          "*Два комп’ютери в одній мережі не можуть мати однакову IP-адресу",
          "IP-адреса складається з літер",
          "*Маршрутизатор теж має IP-адресу",
        ],
        2,
      ),
      typed(
        questionOf(
          "short",
          "q6",
          "Як називається адреса комп’ютера в мережі, наприклад 192.168.1.15? Напишіть абревіатуру.",
          { tags: ["Урок 9"], accepted: ["IP", "IP-адреса"] },
        ),
        "IP",
        "URL",
      ),
      choice("q7", ["Урок 9"], "Яку з цих IP-адрес записано правильно?", [
        "*192.168.1.15",
        "192.168.1.256",
        "192.168.1",
      ]),
      typed(
        exact(
          "q8",
          ["Урок 9"],
          "Зі скількох бітів складається адреса IPv4?",
          32,
        ),
        "32",
        "16",
      ),
      choice(
        "q9",
        ["Мережі", "Урок 9"],
        "Яка служба перетворює доменне ім’я сайту на IP-адресу?",
        ["*DNS", "HTTP", "USB"],
      ),
    ],
  },
  en: {
    title: "Computer Science. Networks",
    items: [
      choice("q1", ["Networks", "Lesson 8"], "What is a computer network?", [
        "*Computers connected to each other to share data",
        "A program for viewing web pages",
        "A set of files on one disk",
      ]),
      choice(
        "q2",
        ["Networks", "Lesson 8"],
        "Which of these devices are network equipment?",
        ["*Router", "*Switch", "Scanner", "Monitor"],
        2,
      ),
      grid(
        "q3",
        ["Networks", "Lesson 8"],
        "Is each network local or global?",
        ["Local", "Global"],
        [
          ["The computer lab network", 0],
          ["The internet", 1],
          ["A home Wi-Fi network", 0],
        ],
        2,
      ),
      choice(
        "q4",
        ["Networks", "Lesson 8"],
        "All the computers in the lab are connected to one switch. What is this network topology called?",
        ["*Star", "Ring", "Bus"],
      ),
      statements(
        "q5",
        ["Lesson 8"],
        "Are these statements about IP addresses true?",
        [
          "*Two computers on the same network cannot share an IP address",
          "An IP address is made of letters",
          "*A router has an IP address too",
        ],
        2,
      ),
      typed(
        questionOf(
          "short",
          "q6",
          "What is the address of a computer on a network, such as 192.168.1.15, called? Type the abbreviation.",
          { tags: ["Lesson 9"], accepted: ["IP", "IP address"] },
        ),
        "IP",
        "URL",
      ),
      choice(
        "q7",
        ["Lesson 9"],
        "Which of these IP addresses is written correctly?",
        ["*192.168.1.15", "192.168.1.256", "192.168.1"],
      ),
      typed(
        exact("q8", ["Lesson 9"], "How many bits long is an IPv4 address?", 32),
        "32",
        "16",
      ),
      choice(
        "q9",
        ["Networks", "Lesson 9"],
        "Which service turns a website’s domain name into an IP address?",
        ["*DNS", "HTTP", "USB"],
      ),
    ],
  },
};

/**
 * The class: the fixtures' four students and two more, so the journal has
 * six rows. `pc` labels the student's computer; `plan` marks each answer
 * right (+) or wrong (-), most mistakes falling on «Урок 9» so the scores
 * per tag differ; `live` is how many are answered when the live journal is
 * taken, and `away` loses the network after them.
 */
const STUDENTS = [
  { name: CLASS[0], pc: "3", plan: "+++++++-+", live: 9 },
  { name: CLASS[2], pc: "12", plan: "++-++-+-+", live: 3, away: true },
  { name: CLASS[1], pc: "7", plan: "+-++--+-+", live: 5 },
  { name: "Мельник Софія", pc: "5", plan: "+++++++++", live: 6 },
  { name: CLASS[3], pc: "9", plan: "-+++++-++", live: 4 },
  { name: "Шевченко Андрій", pc: "14", plan: "++-+++--+", live: 2 },
];

/** Answers questions `from` up to `to` as `plan` says, handing the test in after the last. */
async function answer(
  page: Page,
  items: Item[],
  plan: string,
  from: number,
  to: number,
) {
  for (let i = from; i < to; i++) {
    await items[i].answer(page, plan[i] === "+");
    const last = i === items.length - 1;
    await page
      .getByRole("button", { name: last ? m.test_finish() : m.test_next() })
      .click();
    if (last) {
      await page.getByRole("button", { name: m.review_finish() }).click();
    }
  }
}

const answered = (cells: string[]) =>
  cells.filter((c) => c === "correct" || c === "wrong").length;

const shot = (page: Page, lang: Lang, name: string) =>
  page.screenshot({
    path: join(
      import.meta.dirname,
      "../../site/src/assets/shots",
      lang,
      `${name}.png`,
    ),
  });

for (const lang of ["uk", "en"] as const) {
  test(`the site's screenshots in ${lang}`, async ({ klats }) => {
    const { title, items } = TESTS[lang];
    const locale = { locale: lang };
    const teacher = await klats.teacher("/live");
    const origin = new URL(teacher.url()).origin;
    // The teacher's session cookie authorizes these calls.
    const api = async <T>(method: string, path: string, data?: unknown) => {
      const res = await teacher.request.fetch(origin + path, { method, data });
      if (!res.ok()) {
        throw new Error(
          `${method} ${path}: ${res.status()} ${await res.text()}`,
        );
      }
      return (res.status() === 204 ? undefined : await res.json()) as T;
    };

    const testId = await klats.create(
      items.map((i) => i.question),
      undefined,
      title,
    );
    const cls = await api<{ id: string }>("POST", "/api/classes", {
      id: "",
      name: "7-Б",
      students: STUDENTS.map(({ name }) => ({ id: "", name })),
    });
    const { code, assignmentId } = await api<SittingInfo>(
      "POST",
      "/api/sittings",
      { testId, classId: cls.id },
    );

    const computers: Page[] = [];
    for (const s of STUDENTS) {
      const page = await klats.computer();
      computers.push(page);
      // The computer is labelled once the code is in, before the name is
      // picked, so the join event already names it.
      await page.goto(`${klats.student}/?code=${code}`);
      await expect(page.getByText(s.name, { exact: true })).toBeVisible();
      const token = await page.evaluate(() =>
        localStorage.getItem("klats.device"),
      );
      await api("PUT", `/api/devices/${token}`, { label: s.pc });
      await joinAs(page, klats, code, s.name);
    }
    for (const [i, s] of STUDENTS.entries()) {
      const page = computers[i];
      await answer(page, items, s.plan, 0, s.live);
      if (s.away) {
        await until(
          klats,
          (live) =>
            answered(live.rows.find((r) => r.name === s.name)?.cells ?? []) ===
            s.live,
        );
        await page.context().setOffline(true);
      }
    }

    // Every save sends the whole settings, and a data folder started with
    // -port has no saved port yet.
    const settings = await api<{ port: number }>("GET", "/api/settings");
    const network = await api<{ port: number }>("GET", "/api/network");
    await api("PUT", "/api/settings", {
      ...settings,
      port: settings.port || network.port,
      language: lang,
    });

    // The server calls a computer offline after 15 s without a request.
    await until(
      klats,
      (live) =>
        STUDENTS.every((s) => {
          const r = live.rows.find((r) => r.name === s.name);
          const status = s.away
            ? "offline"
            : s.live === items.length
              ? "finished"
              : "writing";
          return r?.status === status && answered(r.cells) === s.live;
        }),
      30_000,
    );
    await teacher.reload();
    const away = STUDENTS.find((s) => s.away)?.name ?? "";
    await expect(
      teacher.getByText(m.ev_offline({ name: away }, locale)),
    ).toBeVisible();
    await shot(teacher, lang, "live");

    for (const [i, s] of STUDENTS.entries()) {
      const page = computers[i];
      if (s.away) await page.context().setOffline(false);
      await answer(page, items, s.plan, s.live, items.length);
    }
    await until(
      klats,
      (live) => live.rows.every((r) => r.status === "finished"),
      30_000,
    );
    await api("POST", "/api/sittings/current/end");
    await teacher.goto(`${origin}/assignments/${assignmentId}`);
    await expect(
      teacher.getByRole("heading", { name: m.results_tags({}, locale) }),
    ).toBeVisible();
    await shot(teacher, lang, "results");

    await teacher.goto(`${origin}/tests/${testId}?q=q2`);
    await expect(
      teacher.getByRole("textbox", {
        name: m.builder_question_text({}, locale),
      }),
    ).toContainText(items[1].question.title);
    await shot(teacher, lang, "builder");

    // A lab computer opens the student app in the language of its last test.
    const student = await klats.computer();
    await student.setViewportSize({ width: 1366, height: 768 });
    await student.addInitScript(
      (lang) => localStorage.setItem("klats.lang", lang),
      lang,
    );
    await student.goto(klats.student);
    await student
      .getByRole("textbox", { name: m.join_title({}, locale) })
      .fill(code.slice(0, 3));
    // Reduced motion still fades the digits in.
    const digits = student.locator(".s-digit");
    await expect(digits).toHaveCount(3);
    for (const digit of await digits.all()) {
      await expect(digit).toHaveCSS("opacity", "1");
    }
    await shot(student, lang, "student");
  });
}
