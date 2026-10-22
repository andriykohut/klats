/**
 * Reports each time the student leaves the test page and comes back: `true`
 * when the tab is hidden or the window loses focus, `false` once it is both
 * visible and focused again. A hide and a blur together are reported once,
 * as is the return. It returns a function that stops watching.
 */
export function watchFocus(report: (left: boolean) => void): () => void {
  let blurred = false;
  let left = false;
  const onChange = (e: Event) => {
    if (e.type !== "visibilitychange") blurred = e.type === "blur";
    const now = document.hidden || blurred;
    if (now === left) return;
    left = now;
    report(now);
  };
  // shortcut: leaving fullscreen is not watched, since nothing in this version
  // enters it and F11 does not set document.fullscreenElement; add a
  // fullscreenchange check when a test can start in fullscreen.
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("blur", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("blur", onChange);
    window.removeEventListener("focus", onChange);
  };
}
