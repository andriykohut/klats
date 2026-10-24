import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { getMathRenderer, subscribeMath } from "./registry";
import "./math.css";

/**
 * An inline formula drawn from LaTeX `latex` by the registered renderer (see
 * {@link setMathRenderer}). Until one is registered it shows the LaTeX in a
 * muted monospace font, and it is drawn as soon as one is.
 */
export function MathView({ latex }: { latex: string }) {
  const render = useSyncExternalStore(subscribeMath, getMathRenderer);
  const el = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (render && el.current) render(latex, el.current);
  }, [render, latex]);
  return (
    <span ref={el} className={render ? "k-math" : "k-math-src"}>
      {render ? null : latex}
    </span>
  );
}
