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
  back: "M15 5l-7 7 7 7",
  caret: "M7 10l5 5 5-5",
  minus: "M5 12h14",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z",
  single:
    "M12 5a7 7 0 1 0 0 14 7 7 0 1 0 0-14zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z",
  multi:
    "M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM8.5 12l2.5 2.5 4.5-5",
  image:
    "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM3.5 16l5-5 4 4 3-3 5 5M15.5 9h.01",
  more: "M5.5 12h.01M12 12h.01M18.5 12h.01",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
} as const;

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="t-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
