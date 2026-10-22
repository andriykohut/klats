/*
 * Line icons on a 24-unit grid, drawn with the current text colour. They are
 * decorative: the control around each one carries the label.
 */

const PATHS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  trash:
    "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  copy: "M9 9h10v10H9zM5 15V5h10",
  arrow: "M5 12h14M13 6l6 6-6 6",
  alert:
    "M12 8v5M12 16.5v.5M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
  paste:
    "M9 4h6v3H9zM15 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2M9 12h6M9 16h4",
} as const;

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="t-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
