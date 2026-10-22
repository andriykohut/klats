/**
 * Opens a window of `ms` in which an action can still be taken back. `done`
 * resolves true once the window has passed, or false as soon as `undo` is
 * called inside it; an `undo` after that does nothing.
 */
export function undoWindow(ms: number): {
  done: Promise<boolean>;
  undo: () => void;
} {
  let finish: (commit: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    finish = (commit) => {
      clearTimeout(timer);
      resolve(commit);
    };
  });
  return { done, undo: () => finish(false) };
}
