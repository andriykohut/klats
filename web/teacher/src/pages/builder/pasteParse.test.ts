import type { Question } from "@klats/shared/generated/testfmt.ts";
import { expect, test } from "vitest";
import { plainText } from "./model";
import promptEn from "./paste-prompt.en.txt?raw";
import promptUk from "./paste-prompt.uk.txt?raw";
import { parsePasted } from "./pasteParse";

const only = (text: string): Question => {
  const { questions, skipped } = parsePasted(text);
  expect(skipped).toEqual([]);
  expect(questions).toHaveLength(1);
  return questions[0].question;
};

const options = (q: Question) =>
  q.options.map((o) => [plainText(o.content), o.correct]);

const placed = (q: Question) =>
  q.options.map((o) => {
    const t = q.targets?.find((x) => x.id === o.target);
    return [plainText(o.content), t ? plainText(t.content) : null];
  });

test("numbered questions with starred answers become single and multiple choice", () => {
  const { questions, skipped } = parsePasted(
    "1. Скільки біт\r\nв одному байті?\r\nа) 2\r\n\r\nб) 4\r\n*в) 8\r\n\r\n2) Пристрої введення?\n* A) клавіатура\nB) монітор\nc) * мишка\n- сканер *\n",
  );
  expect(skipped).toEqual([]);
  expect(
    questions.map(({ question: q, title }) => [
      q.type,
      title,
      options(q),
      q.points,
    ]),
  ).toEqual([
    [
      "single",
      "Скільки біт в одному байті?",
      [
        ["2", false],
        ["4", false],
        ["8", true],
      ],
      1,
    ],
    [
      "multi",
      "Пристрої введення?",
      [
        ["клавіатура", true],
        ["монітор", false],
        ["мишка", true],
        ["сканер", true],
      ],
      1,
    ],
  ]);
});

test("a type name in brackets sets the type, in either language and any case", () => {
  const { questions } = parsePasted(
    "1. [правда чи неправда] Оберіть.\nа) *Земля кругла.\nб) Місяць — планета.\n2. [Ordering] Order them.\n- one\n- two\n- three\n3. [Одна відповідь] Лише одна?\nа) *так\nб) *ні",
  );
  expect(questions.map((p) => [p.question.type, options(p.question)])).toEqual([
    [
      "truefalse",
      [
        ["Земля кругла.", true],
        ["Місяць — планета.", false],
      ],
    ],
    [
      "order",
      [
        ["one", false],
        ["two", false],
        ["three", false],
      ],
    ],
    [
      "single",
      [
        ["так", true],
        ["ні", true],
      ],
    ],
  ]);
});

test("typed answers: accepted spellings, number keys and marking notes", () => {
  const short = only(
    "1. [Коротка відповідь] Хто написав «Кобзар»?\n= Шевченко\n= Тарас Шевченко",
  );
  expect(short.accepted).toEqual(["Шевченко", "Тарас Шевченко"]);

  const keys = [
    "= 7",
    "= -2,5",
    "= 3,14 ± 0,01",
    "= 3.1 +- 0.1",
    "= 3..4",
    "= −1,5 … 2",
  ].map((k) => only(`1. [Число] Скільки?\n${k}`).number);
  expect(keys).toEqual([
    { mode: "exact", value: 7, tolerance: 0, min: 0, max: 0 },
    { mode: "exact", value: -2.5, tolerance: 0, min: 0, max: 0 },
    { mode: "tolerance", value: 3.14, tolerance: 0.01, min: 0, max: 0 },
    { mode: "tolerance", value: 3.1, tolerance: 0.1, min: 0, max: 0 },
    { mode: "range", value: 0, tolerance: 0, min: 3, max: 4 },
    { mode: "range", value: 0, tolerance: 0, min: -1.5, max: 2 },
  ]);

  const open = only(
    "1. [Розгорнута відповідь] Опишіть вірш.\n= Назва й автор.\n= Рядок для прикладу.",
  );
  expect(open.rubric).toBe("Назва й автор.\nРядок для прикладу.");
  expect(only("1. [Written answer] Why?").rubric).toBe("");
});

test("pairs, groups and grid rows say where each item belongs, and ~ adds a spare", () => {
  const match = only(
    "1. [Відповідності] Зʼєднайте.\n- Київ -> Україна\n- Варшава → Польща\n- Львів -> Україна\n~ Іспанія",
  );
  expect(placed(match)).toEqual([
    ["Київ", "Україна"],
    ["Варшава", "Польща"],
    ["Львів", "Україна"],
  ]);
  // Every pair keeps its own right-hand side; the spare is one more.
  expect(match.targets?.map((t) => plainText(t.content))).toEqual([
    "Україна",
    "Польща",
    "Україна",
    "Іспанія",
  ]);

  const groups = only(
    "1. [Групування] Розкладіть.\n- кіт -> Ссавці\n- горобець -> Птахи\n- кит -> Ссавці\n~ Риби",
  );
  expect(groups.targets?.map((t) => plainText(t.content))).toEqual([
    "Ссавці",
    "Птахи",
    "Риби",
  ]);
  expect(placed(groups)).toEqual([
    ["кіт", "Ссавці"],
    ["горобець", "Птахи"],
    ["кит", "Ссавці"],
  ]);

  const grid = only(
    "1. [Таблиця вибору] Метал чи ні?\n- Залізо -> Метал\n- Сірка -> Неметал\n~ Напівметал",
  );
  expect(grid.targets?.map((t) => plainText(t.content))).toEqual([
    "Метал",
    "Неметал",
    "Напівметал",
  ]);
  expect(placed(grid)).toEqual([
    ["Залізо", "Метал"],
    ["Сірка", "Неметал"],
  ]);
});

test("gaps take typed spellings or a starred list, in a text below the task", () => {
  const q = only(
    "1. [Пропуски в тексті] Заповніть.\nСтолиця — [Київ|Kyiv].\nТече [*Дніпро | Десна].",
  );
  expect(plainText(q.text)).toBe("Заповніть.");
  const [typed, list] = q.gaps ?? [];
  expect(q.body).toEqual({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Столиця — " },
          { type: "gap", attrs: { id: typed.id } },
          { type: "text", text: "." },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Тече " },
          { type: "gap", attrs: { id: list.id } },
          { type: "text", text: "." },
        ],
      },
    ],
  });
  expect(typed.accepted).toEqual(["Київ", "Kyiv"]);
  expect(list.choices?.map((c) => [c.text, c.correct])).toEqual([
    ["Дніпро", true],
    ["Десна", false],
  ]);
});

test("a text question on one line has no task", () => {
  const q = only("1. [Gaps in text] The capital is [Kyiv].");
  expect(plainText(q.text)).toBe("");
  expect(q.gaps?.map((g) => g.accepted)).toEqual([["Kyiv"]]);
});

test("a word bank's words go into its gaps, and ~ adds a spare word", () => {
  const q = only(
    "1. [Слова в текст] Перетягніть.\nКиїв — [столиця], Дніпро — [річка].\n~ гора",
  );
  const gaps = (
    q.body.content[0].content as { type: string; attrs?: { id: string } }[]
  )
    .filter((n) => n.type === "gap")
    .map((n) => n.attrs?.id);
  expect(
    q.options.map((o) => [plainText(o.content), o.target ?? null]),
  ).toEqual([
    ["столиця", gaps[0]],
    ["річка", gaps[1]],
    ["гора", null],
  ]);
});

test("highlight marks the words in brackets", () => {
  const q = only(
    "1. [Виділення слів] Позначте іменники.\n[Кіт] спить на [дивані].",
  );
  expect(q.body).toEqual({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Кіт", marks: [{ type: "target" }] },
          { type: "text", text: " спить на " },
          { type: "text", text: "дивані", marks: [{ type: "target" }] },
          { type: "text", text: "." },
        ],
      },
    ],
  });
});

test("$…$ becomes a formula, and brackets inside it are not gaps", () => {
  const choice = only("1. Чому дорівнює $x^2$ при x = 3?\nа) *$9$\nб) 6");
  expect(choice.text.content[0].content).toEqual([
    { type: "text", text: "Чому дорівнює " },
    { type: "math", attrs: { latex: "x^2" } },
    { type: "text", text: " при x = 3?" },
  ]);
  expect(choice.options[0].content.content[0].content).toEqual([
    { type: "math", attrs: { latex: "9" } },
  ]);

  const gaps = only("1. [Пропуски в тексті] Обчисліть.\n$\\sqrt[3]{8}$ = [2]");
  expect(gaps.gaps?.map((g) => g.accepted)).toEqual([["2"]]);
});

test("points and tags lines set a question's points and tags", () => {
  const q = only(
    "1. Q\nа) *так\nб) ні\nБали: 3\nТеги: дроби,  множення, дроби",
  );
  expect([q.points, q.tags]).toEqual([3, ["дроби", "множення"]]);
  expect(only("1. Q\na) *yes\nPoints: 12\nTags: maths").points).toBe(12);
});

test("lines and questions that cannot be read are listed with the reason", () => {
  const { questions, skipped } = parsePasted(
    [
      "Тест з історії",
      "1. [Хронологія] Що раніше?",
      "- А",
      "2. [Місце на зображенні] Де Київ?",
      "3. Питання без відповідей",
      "4. Столиця?",
      "а) *Київ",
      "= Київ",
      "Зайвий рядок",
      "Бали: 20",
      "5. [Число] Скільки?",
      "= багато",
      "6. [Відповідності] Пари",
      "- Київ Україна",
      "- Варшава -> Польща",
    ].join("\n"),
  );
  expect(questions.map((p) => p.title)).toEqual(["Столиця?", "Пари"]);
  expect(skipped).toEqual([
    { line: "Тест з історії", reason: "line" },
    { line: "1. [Хронологія] Що раніше?", reason: "type" },
    { line: "2. [Місце на зображенні] Де Київ?", reason: "picture" },
    { line: "3. Питання без відповідей", reason: "empty" },
    { line: "Зайвий рядок", reason: "line" },
    { line: "Бали: 20", reason: "points" },
    { line: "= Київ", reason: "line" },
    { line: "= багато", reason: "number" },
    { line: "5. [Число] Скільки?", reason: "empty" },
    { line: "- Київ Україна", reason: "line" },
  ]);
});

test.each([
  ["uk", promptUk],
  ["en", promptEn],
])(
  "the %s prompt's example reads as one question of each type, plus code and a table",
  (_, prompt) => {
    const example = /```\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? "";
    const { questions, skipped } = parsePasted(example);
    expect(skipped).toEqual([]);
    expect(questions.map((p) => p.question.type)).toEqual([
      "single",
      "multi",
      "truefalse",
      "short",
      "number",
      "gaps",
      "bank",
      "highlight",
      "order",
      "match",
      "groups",
      "grid",
      "open",
      "single",
      "number",
    ]);
  },
);

test("a number needs no space after it, and a dash-led quote stays in the question", () => {
  const { questions, skipped } = parsePasted(
    "1.Хто сказав:\n— Борітеся — поборете!\nа) *Шевченко\nб) Франко",
  );
  expect(skipped).toEqual([]);
  expect(questions.map((p) => [p.title, options(p.question)])).toEqual([
    [
      "Хто сказав: — Борітеся — поборете!",
      [
        ["Шевченко", true],
        ["Франко", false],
      ],
    ],
  ]);
});

test("a text question's task may stand on its own line, and dashed lines and decimals stay text", () => {
  const q = only(
    "1. [Пропуски в тексті]\nЗаповніть.\n- Де ти [був]?\n- Біля [Дніпра*|Десни].\n3.14 — це [π].",
  );
  expect(plainText(q.text)).toBe("Заповніть.");
  expect(
    q.body.content.map(
      (p: { content: { text?: string }[] }) => p.content[0].text,
    ),
  ).toEqual(["- Де ти ", "- Біля ", "3.14 — це "]);
  expect(
    q.gaps?.map(
      (g) => g.accepted ?? g.choices?.map((c) => [c.text, c.correct]),
    ),
  ).toEqual([
    ["був"],
    [
      ["Дніпра", true],
      ["Десни", false],
    ],
    ["π"],
  ]);
});

test("prices in dollars stay text", () => {
  const q = only("1. A pen costs $2 and a book $10. Total?\na) *12\nb) 8");
  expect(q.text.content[0].content).toEqual([
    { type: "text", text: "A pen costs $2 and a book $10. Total?" },
  ]);
});

test("Markdown in questions and answers becomes formatting, and a star pair is italic, not a correct mark", () => {
  const q = only(
    "1. Яке слово **не** є іменником?\n*а) _бігти_\nб) *кіт*\nв) H~2~O і x^2^\nг) `print` і my_var_name",
  );
  expect(q.type).toBe("single");
  expect(q.text.content[0].content).toEqual([
    { type: "text", text: "Яке слово " },
    { type: "text", text: "не", marks: [{ type: "bold" }] },
    { type: "text", text: " є іменником?" },
  ]);
  expect(
    q.options.map((o) => [o.correct, o.content.content[0].content]),
  ).toEqual([
    [true, [{ type: "text", text: "бігти", marks: [{ type: "italic" }] }]],
    [false, [{ type: "text", text: "кіт", marks: [{ type: "italic" }] }]],
    [
      false,
      [
        { type: "text", text: "H" },
        { type: "text", text: "2", marks: [{ type: "subscript" }] },
        { type: "text", text: "O і x" },
        { type: "text", text: "2", marks: [{ type: "superscript" }] },
      ],
    ],
    [
      false,
      [
        { type: "text", text: "print", marks: [{ type: "code" }] },
        { type: "text", text: " і my_var_name" },
      ],
    ],
  ]);
});

test("a question's text holds tables and code blocks, kept as written", () => {
  const q = only(
    [
      "1. Що виведе програма для даних з таблиці?",
      "| x | y |",
      "|---|---|",
      "| 2 | **3** |",
      "~~~python",
      "def f(x, y):",
      "",
      "    return x ** y",
      "~~~",
      "~~~C++",
      "int x;",
      "~~~",
      "~~~java",
      "int y;",
      "~~~",
      "а) *8",
      "б) 9",
    ].join("\n"),
  );
  const cell = (type: string, ...content: object[]) => ({
    type,
    content: [{ type: "paragraph", content }],
  });
  expect(q.text).toEqual({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Що виведе програма для даних з таблиці?" },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              cell("tableHeader", { type: "text", text: "x" }),
              cell("tableHeader", { type: "text", text: "y" }),
            ],
          },
          {
            type: "tableRow",
            content: [
              cell("tableCell", { type: "text", text: "2" }),
              cell("tableCell", {
                type: "text",
                text: "3",
                marks: [{ type: "bold" }],
              }),
            ],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "python" },
        content: [{ type: "text", text: "def f(x, y):\n\n    return x ** y" }],
      },
      {
        type: "codeBlock",
        attrs: { language: "cpp" },
        content: [{ type: "text", text: "int x;" }],
      },
      { type: "codeBlock", content: [{ type: "text", text: "int y;" }] },
    ],
  });
  expect(options(q)).toEqual([
    ["8", true],
    ["9", false],
  ]);
});

test("a blank line in a question's text starts a new paragraph", () => {
  const q = only(
    "1. Прочитайте уривок.\n\nЖив собі кіт.\nВін спав.\n\nПро кого йдеться?\n\nа) *кіт\n\nб) пес",
  );
  expect(
    q.text.content.map(
      (p: { content: { text: string }[] }) => p.content[0].text,
    ),
  ).toEqual([
    "Прочитайте уривок.",
    "Жив собі кіт. Він спав.",
    "Про кого йдеться?",
  ]);
  expect(options(q)).toEqual([
    ["кіт", true],
    ["пес", false],
  ]);
});

test("stars and underscores inside words, and signs after a backslash, stay text", () => {
  const q = only(
    "1. Обчисліть 3*4*5 для my_var_name, а \\*це\\* й \\$5 — без змін.\nа) *60\nб) 12 \\*",
  );
  expect(q.text.content[0].content).toEqual([
    {
      type: "text",
      text: "Обчисліть 3*4*5 для my_var_name, а *це* й $5 — без змін.",
    },
  ]);
  expect(options(q)).toEqual([
    ["60", true],
    ["12 *", false],
  ]);
});

test("the ``` lines of a copied chatbot code block are ignored", () => {
  const { questions, skipped } = parsePasted(
    "```text\n1. Столиця України?\n*а) Київ\nб) Львів\n```\n",
  );
  expect(skipped).toEqual([]);
  expect(questions.map((p) => options(p.question))).toEqual([
    [
      ["Київ", true],
      ["Львів", false],
    ],
  ]);
});
