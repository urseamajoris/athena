/** Move keyboard focus to a node card (after React has rendered it). */
export function focusNode(id: string) {
  requestAnimationFrame(() => (document.querySelector(`[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus({ preventScroll: true }));
}

/** Imperative canvas commands, registered by the canvas while it is mounted (no-ops in List view). */
export const canvasCommands = { fit: () => {} };

// Whether the last input was the keyboard (not a pointer): moved focus then shows a ring; mouse users see none.
// Tracked from the moment the session shell loads, so the first panel opened with Enter already counts.
let lastInput: "keyboard" | "pointer" = "pointer";
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey) lastInput = "keyboard"; }, true);
  window.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
}
export const usingKeyboard = () => lastInput === "keyboard";

/**
 * Focus an element outside the Tab order (a panel heading), with a visible ring for keyboard users
 * (globals.css: [data-focus-ring]) that goes away when focus moves on.
 */
export function focusWithRing(el: HTMLElement | null) {
  if (!el) return;
  if (usingKeyboard()) {
    el.setAttribute("data-focus-ring", "");
    el.addEventListener("blur", () => el.removeAttribute("data-focus-ring"), { once: true });
  }
  el.focus({ preventScroll: true });
}
