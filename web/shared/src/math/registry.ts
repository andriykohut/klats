import type { StudentTest } from "../generated/wire";

/*
 * Formulas are drawn by KaTeX, which the student app loads only for a test
 * that has formulas, so shared code never imports it. Each app registers a
 * renderer once; {@link MathView} reads it with `useSyncExternalStore` over
 * {@link subscribeMath} and {@link getMathRenderer}, and redraws when one
 * arrives.
 */

/** Draws `latex` into `el`, replacing its content. */
type Renderer = (latex: string, el: HTMLElement) => void;

let renderer: Renderer | null = null;
const listeners = new Set<() => void>();

/** Sets the function that draws formulas, and redraws every formula shown. */
export function setMathRenderer(render: Renderer): void {
  renderer = render;
  for (const l of listeners) l();
}

/** The registered renderer, or null before one is set. */
export const getMathRenderer = (): Renderer | null => renderer;

/** Subscribes to renderer changes, as useSyncExternalStore takes it. */
export function subscribeMath(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The options every KaTeX call uses. `trust` stays off so a formula can't
 * produce links or raw HTML; `maxSize` and `maxExpand` bound what a hostile
 * or careless formula can cost.
 */
export const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: "ignore",
  maxSize: 20,
  maxExpand: 200,
} as const;

interface Picture {
  content?: unknown;
}

/** A question as the server sends it, with the fields of every type. */
type Question = StudentTest["questions"][number] & {
  body?: unknown;
  targets?: Picture[];
};

/**
 * Reports whether any rich text of `test` holds a formula: a question's text
 * and body, its options and its targets.
 */
export function hasMath(test: StudentTest): boolean {
  const walk = (node: unknown): boolean => {
    const n = node as { type?: string; content?: unknown[] } | null;
    return n?.type === "math" || (n?.content?.some(walk) ?? false);
  };
  return (test.questions as Question[]).some(
    (q) =>
      walk(q.text) ||
      walk(q.body) ||
      q.options.some((o) => walk(o.content)) ||
      (q.targets?.some((t) => walk(t.content)) ?? false),
  );
}
