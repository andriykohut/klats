import { expect, test } from "vitest";
import { parsePasted } from "./pasteParse";

test("parses numbered questions with starred answers", () => {
  const q = parsePasted(
    "1. Скільки біт в одному байті?\r\nа) 2\r\nб) 4\r\n*в) 8\r\n\r\n2. Пристрої введення?\n*а) клавіатура\nб) монітор\nв) мишка*\n",
  );
  expect(q).toHaveLength(2);
  expect(q[0]).toEqual({
    text: "Скільки біт в одному байті?",
    type: "single",
    options: [
      { text: "2", correct: false },
      { text: "4", correct: false },
      { text: "8", correct: true },
    ],
  });
  expect(q[1].type).toBe("multi");
  expect(q[1].options.map((o) => o.correct)).toEqual([true, false, true]);
});

test("continuation lines join the question text", () => {
  const q = parsePasted(
    "1. Яка формула води,\nякщо в молекулі два атоми\nгідрогену?\nа) H2O\nб) CO2",
  );
  expect(q[0].text).toBe(
    "Яка формула води, якщо в молекулі два атоми гідрогену?",
  );
  expect(q[0].options).toHaveLength(2);
});

test("questions without options are dropped", () => {
  const q = parsePasted(
    "1. Без відповідей\n2. З відповідями\nа) так\nб) ні\n3. Теж без них\n",
  );
  expect(q.map((x) => x.text)).toEqual(["З відповідями"]);
});

test("Latin option letters, any case", () => {
  const q = parsePasted("1. Pick one\na) first\nB) second\n*C) third");
  expect(q[0].options).toEqual([
    { text: "first", correct: false },
    { text: "second", correct: false },
    { text: "third", correct: true },
  ]);
});

test("numbering with a closing parenthesis", () => {
  const q = parsePasted("1) Перше\nа) так\nб) ні\n2) Друге\nа) так\nб) ні");
  expect(q.map((x) => x.text)).toEqual(["Перше", "Друге"]);
});

test("a star before the letter, after the parenthesis or at the end marks it correct", () => {
  const q = parsePasted("1. Q\n* а) one\nб) * two\nв) three *\nг) four");
  expect(q[0].options).toEqual([
    { text: "one", correct: true },
    { text: "two", correct: true },
    { text: "three", correct: true },
    { text: "four", correct: false },
  ]);
  expect(q[0].type).toBe("multi");
});

test("a question with one option is kept", () => {
  const q = parsePasted("1. Лише одна\n*а) так");
  expect(q).toEqual([
    {
      text: "Лише одна",
      type: "single",
      options: [{ text: "так", correct: true }],
    },
  ]);
});

test("blank lines between options are skipped", () => {
  const q = parsePasted("1. Q\n\nа) one\n\n   \nб) two\n\n*в) three");
  expect(q[0].options.map((o) => o.text)).toEqual(["one", "two", "three"]);
  expect(q[0].type).toBe("single");
});

test("a question with no correct option stays single", () => {
  expect(parsePasted("1. Q\nа) one\nб) two")[0].type).toBe("single");
});
