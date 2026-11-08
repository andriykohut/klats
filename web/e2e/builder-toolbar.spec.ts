import { doc, expect, m, questionOf, test } from "./fixtures";

/** A 1×1 PNG: the label editor shows its points once the question has a picture. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);

const option = (id: string, label: string, target = "") => ({
  id,
  content: doc(label),
  correct: false,
  target,
});
const target = (id: string, label: string) => ({
  id,
  content: doc(label),
  x: 0,
  y: 0,
});
const gap = (id: string) => ({ type: "gap", attrs: { id } });

/** Every list heading of a question type, whose first rich field the toolbar floats over. */
const CASES = [
  {
    type: "bank",
    headings: [
      m.builder_bank_body,
      m.builder_bank_words,
      m.builder_bank_decoys,
    ],
    fields: () => ({
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              gap("w1"),
              { type: "text", text: " сидить на " },
              gap("w2"),
            ],
          },
        ],
      },
      options: [
        option("k1", "Кіт", "w1"),
        option("k2", "килимку", "w2"),
        option("k3", "хмарі"),
      ],
    }),
  },
  {
    type: "order",
    headings: [m.builder_order_items],
    fields: () => ({
      options: [option("a", "Прокинутися"), option("b", "Поснідати")],
    }),
  },
  {
    type: "truefalse",
    headings: [m.builder_statements],
    fields: () => ({
      options: [
        { ...option("s1", "Земля кругла"), correct: true },
        option("s2", "Сонце холодне"),
      ],
    }),
  },
  {
    type: "grid",
    headings: [m.builder_columns, m.builder_rows],
    fields: () => ({
      targets: [target("c1", "Ссавці"), target("c2", "Птахи")],
      options: [option("r1", "Кіт", "c1"), option("r2", "Горобець", "c2")],
    }),
  },
  {
    type: "match",
    headings: [m.builder_pairs, m.builder_decoys],
    fields: () => ({
      targets: [target("t1", "Київ"), target("t2", "Атлантида")],
      options: [option("l1", "Україна", "t1")],
    }),
  },
  {
    type: "label",
    headings: [m.builder_points, m.builder_label_decoys],
    fields: (image: string) => ({
      image: { src: image, w: 1, h: 1 },
      targets: [target("p1", "")],
      options: [option("l1", "Сонце", "p1"), option("l2", "Місяць")],
    }),
  },
];

for (const c of CASES) {
  test(`the toolbar of a ${c.type} question's list fields leaves their headings visible`, async ({
    klats,
  }) => {
    const src = await klats.upload(PNG);
    const id = await klats.create([
      questionOf(c.type, "q1", "Питання", c.fields(src)),
    ]);
    const page = await klats.teacher(`/tests/${id}`);
    const main = page.getByRole("main");

    for (const title of c.headings) {
      const heading = main.locator(".b-lbl", { hasText: title() }).first();
      await heading.scrollIntoViewIfNeeded();
      const field = heading.locator("xpath=following::*[@role='textbox'][1]");
      await field.focus();
      const bar = field
        .locator(
          "xpath=ancestor::div[contains(concat(' ',@class,' '),' b-rich ')][1]",
        )
        .getByRole("toolbar");
      await expect(bar).toBeVisible();

      const h = await heading.boundingBox();
      const b = await bar.boundingBox();
      if (!h || !b) throw new Error(`no box for ${title()}`);
      const overlaps =
        b.x < h.x + h.width &&
        h.x < b.x + b.width &&
        b.y < h.y + h.height &&
        h.y < b.y + b.height;
      expect
        .soft(overlaps, `the toolbar covers the heading "${title()}"`)
        .toBe(false);
    }
  });
}
