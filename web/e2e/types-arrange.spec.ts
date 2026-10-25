import { doc, expect, joinAs, m, questionOf, test, until } from "./fixtures";

const para = (...content: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const text = (t: string) => ({ type: "text", text: t });
const gap = (id: string) => ({ type: "gap", attrs: { id } });
const option = (id: string, label: string, target = "") => ({
  id,
  content: doc(label),
  correct: false,
  target,
});

test("ordering, matching, groups and word bank are answered by keyboard, touch and mouse", async ({
  klats,
}) => {
  const order = questionOf("order", "q1", "Розставте події дня по порядку", {
    points: 3,
    options: [
      option("a", "Прокинутися"),
      option("b", "Поснідати"),
      option("c", "Піти до школи"),
      option("d", "Повернутися додому"),
    ],
  });
  const match = questionOf("match", "q2", "З’єднайте країни зі столицями", {
    points: 3,
    targets: [
      { id: "t1", content: doc("Київ"), x: 0, y: 0 },
      { id: "t2", content: doc("Варшава"), x: 0, y: 0 },
      { id: "t3", content: doc("Берлін"), x: 0, y: 0 },
      { id: "t4", content: doc("Атлантида"), x: 0, y: 0 },
    ],
    options: [
      option("l1", "Україна", "t1"),
      option("l2", "Польща", "t2"),
      option("l3", "Німеччина", "t3"),
    ],
  });
  const groups = questionOf("groups", "q3", "Розкладіть тварин за групами", {
    points: 2,
    targets: [
      { id: "g1", content: doc("Ссавці"), x: 0, y: 0 },
      { id: "g2", content: doc("Птахи"), x: 0, y: 0 },
    ],
    options: [
      option("i1", "Кіт", "g1"),
      option("i2", "Горобець", "g2"),
      option("i3", "Кит", "g1"),
      option("i4", "Орел", "g2"),
    ],
  });
  const bank = questionOf("bank", "q4", "", {
    points: 2,
    body: para(gap("w1"), text(" сидить на "), gap("w2"), text(".")),
    options: [
      option("k1", "Кіт", "w1"),
      option("k2", "килимку", "w2"),
      option("k3", "хмарі"),
    ],
  });
  const { code, assignmentId } = await klats.start([
    order,
    match,
    groups,
    bank,
  ]);
  const page = await klats.computer(true);
  await joinAs(page, klats, code, "Бондаренко Олена");
  const next = page.getByRole("button", { name: m.test_next() });

  // Ordering: nothing counts until the first move, and every move is a key press.
  const rows = page.getByRole("grid", { name: order.title }).getByRole("row");
  const sequence = () =>
    rows.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  // The right arrow from a row reaches its drag handle and then its ↑ button.
  const shifted = async (label: string) => {
    const before = await sequence();
    // React Aria restores focus to a moved row a few frames after the move,
    // and a key pressed before that lands on the wrong element, so the walk
    // from the row to its button runs again until it ends there.
    await expect(async () => {
      await page.getByRole("row", { name: label }).focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("button", { name: m.order_up({ item: label }) }),
      ).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await expect.poll(sequence).not.toEqual(before);
    // Focus stays on a button of the moved card, whose button at the end is off.
    await expect(page.locator(".k-order-move:focus")).toHaveAttribute(
      "aria-label",
      new RegExp(`: ${label}$`),
    );
  };
  await expect(next).toBeDisabled();
  // Tab from the sheet reaches the list, and React Aria's keyboard drag makes
  // the first move: the top card goes to the end.
  const inList = () =>
    rows.evaluateAll((els) => els.some((e) => e === document.activeElement));
  for (let i = 0; i < 10 && !(await inList()); i++) {
    await page.keyboard.press("Tab");
  }
  expect(await inList()).toBe(true);
  const [top] = await sequence();
  await expect(page.getByRole("row", { name: top ?? "" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sequence()).at(-1)).toBe(top);
  // React Aria moves focus to the dropped card a moment after the drop; the
  // next key press must come after that.
  await expect.poll(inList).toBe(true);
  await expect(next).toBeEnabled();
  const want = [
    "Поснідати",
    "Прокинутися",
    "Піти до школи",
    "Повернутися додому",
  ];
  for (const [i, label] of want.entries()) {
    for (let at = (await sequence()).indexOf(label); at > i; at--) {
      await shifted(label);
    }
  }
  expect(await sequence()).toEqual(want);
  await expect(next).toBeEnabled();
  await next.click();

  // Matching, by tapping: Space or a tap picks a card, and a tap on a place puts it there.
  const tray = page.getByRole("grid", { name: m.cards_tray() });
  const card = (label: string) => tray.getByRole("row", { name: label });
  const here = (slot: string) =>
    page.getByRole("button", { name: m.card_place({ slot }) });
  await card("Київ").tap();
  await here("Україна").tap();
  // A tray card pressed while a placed card is picked is picked instead.
  const picked = page.locator("[data-picked]");
  await page
    .getByRole("grid", { name: "Україна" })
    .getByRole("row", { name: "Київ" })
    .tap();
  await expect(picked).toHaveAttribute("aria-label", "Київ");
  await card("Варшава").tap();
  await expect(picked).toHaveAttribute("aria-label", "Варшава");
  await expect(
    page.getByRole("grid", { name: "Україна" }).getByRole("row"),
  ).toHaveCount(1);
  await here("Польща").tap();
  // The place is full only until a second card arrives: Атлантида swaps out Берлін's seat.
  await card("Берлін").tap();
  await here("Німеччина").tap();
  await expect(next).toBeEnabled();
  await card("Атлантида").tap();
  await here("Німеччина").tap();
  await expect(
    page
      .getByRole("grid", { name: "Німеччина" })
      .getByRole("row", { name: "Атлантида" }),
  ).toBeVisible();
  await expect(card("Берлін")).toBeVisible();
  // A press on the tray takes a placed card back, and the question is open again.
  await page
    .getByRole("grid", { name: "Німеччина" })
    .getByRole("row", { name: "Атлантида" })
    .tap();
  await page.getByRole("button", { name: m.card_return() }).tap();
  await expect(card("Атлантида")).toBeVisible();
  await expect(next).toBeDisabled();
  await card("Атлантида").tap();
  await here("Німеччина").tap();
  await expect(next).toBeEnabled();
  await next.click();

  // Groups, with the mouse: three of four cards are dragged, one stays in the tray.
  const group = (name: string) => page.getByRole("grid", { name });
  // A drop leaves nothing picked. A drag started while the tray is still
  // reflowing from the last drop can miss, so it is tried again.
  const drag = async (label: string, to: string) => {
    await expect(async () => {
      await card(label).dragTo(group(to), { timeout: 2000 });
      await expect(group(to).getByRole("row", { name: label })).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 10_000 });
    await expect(picked).toHaveCount(0);
  };
  await drag("Кіт", "Ссавці");
  await drag("Горобець", "Птахи");
  await drag("Кит", "Ссавці");
  await expect(group("Ссавці").getByRole("row")).toHaveCount(2);
  await expect(tray.getByRole("row")).toHaveCount(1);
  await page.getByRole("button", { name: m.test_skip() }).click();

  // Word bank, with keys. Space picks a word and moves focus to the first gap,
  // Enter puts the word down and focus goes on to the next word in the tray.
  // React Aria's own keyboard drag takes the other word: Enter on its drag
  // handle starts it, Tab visits the places, and Enter drops.
  const gapName = (n: number) => m.gap_label({ number: n });
  const inGap = (n: number, word: string) =>
    page
      .getByRole("grid", { name: gapName(n) })
      .getByRole("row", { name: word });
  await card("Кіт").focus();
  await page.keyboard.press("Space");
  await expect(here(gapName(1))).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(inGap(1, "Кіт")).toBeVisible();
  await expect(page.locator(".k-tray-list [data-card]:focus")).toHaveCount(1);
  await expect(picked).toHaveCount(0);

  await card("килимку").focus();
  await page.keyboard.press("Tab");
  await expect(
    card("килимку").getByRole("button", { name: /^Перетягнути/ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  // The places a dragged card can go to are buttons named for their list.
  const target = page.getByRole("button", {
    name: new RegExp(`${gapName(2)}$`),
  });
  for (
    let i = 0;
    i < 6 && !(await target.evaluate((e) => e === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  // A key pressed at once after the drop leaves nothing picked.
  await page.keyboard.press("Tab");
  await expect(inGap(2, "килимку")).toBeVisible();
  await expect(picked).toHaveCount(0);
  await expect(page.locator(".k-slot-hit")).toHaveCount(0);

  // Enter picks a card without moving on, though the question is answered, and
  // Escape unpicks it and returns focus to it.
  // React Aria moves focus to the dropped card's handle a moment after the
  // drop, and an Enter before that is lost, so the key is tried again until
  // it picks the card.
  await expect(
    inGap(2, "килимку").getByRole("button", { name: /^Перетягнути/ }),
  ).toBeFocused();
  await expect(async () => {
    await card("хмарі").focus();
    await page.keyboard.press("Enter");
    await expect(picked).toHaveAttribute("aria-label", "хмарі", {
      timeout: 1000,
    });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator(".k-slot-hit").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picked).toHaveCount(0);
  await expect(page.locator(".k-slot-hit")).toHaveCount(0);
  await expect(card("хмарі")).toBeFocused();
  await page.getByRole("button", { name: m.test_finish() }).click();
  await page.getByRole("button", { name: m.review_finish() }).click();

  // Ordering b a c d keeps 3 of 4 in sequence: 3 × 2 / 3. Matching has two
  // right and the decoy wrong: 3 × (2 − 1) / 3. Groups has three right of
  // four: 2 × 3 / 4. The bank is whole.
  await until(klats, (live) => live.rows[0]?.status === "finished");
  const { rows: results } = await klats.results(assignmentId);
  expect(results[0].points).toEqual([2, 1, 1.5, 2]);
});
