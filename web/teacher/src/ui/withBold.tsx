import type { MessagePart } from "@klats/shared/paraglide/runtime.js";
import type { ReactNode } from "react";

/**
 * Renders message parts, each {#b}…{/b} span as one `<b>` with `className`.
 */
export function withBold(
  parts: MessagePart[],
  className?: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  let bold: string[] | null = null;
  for (const part of parts) {
    if (part.type === "markup-start") bold = [];
    else if (part.type === "markup-end") {
      out.push(
        <b key={out.length} className={className}>
          {bold?.join("")}
        </b>,
      );
      bold = null;
    } else if (part.type === "text") {
      if (bold) bold.push(part.value);
      else out.push(part.value);
    }
  }
  return out;
}
