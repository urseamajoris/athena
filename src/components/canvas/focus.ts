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
export function focusWithRing(el: HTMLElement | null, { reveal = false } = {}) {
  if (!el) return;
  if (usingKeyboard()) {
    el.setAttribute("data-focus-ring", "");
    el.addEventListener("blur", () => el.removeAttribute("data-focus-ring"), { once: true });
  }
  el.focus({ preventScroll: true });
  // A heading that has scrolled out of view (short screens, where the header scrolls) is brought back into view.
  if (reveal) el.scrollIntoView({ block: "nearest" });
}

/**
 * Scroll a control fully into view inside its side panel, above the panel's footer. On short screens (200% zoom)
 * the footer is pinned over the content, and the browser's own scrolling (or a focus with preventScroll) can leave
 * the control half hidden behind it.
 */
export function revealInPanel(el: HTMLElement | null) {
  const panel = el?.closest<HTMLElement>("[data-panel]");
  if (!el || !panel || el.closest("[data-panel-footer], [data-panel-footer-fallback]")) return;
  const scrolls = (x: HTMLElement | null): x is HTMLElement => !!x && x.scrollHeight > x.clientHeight + 1 && getComputedStyle(x).overflowY !== "visible";
  const body = el.closest<HTMLElement>("[data-panel-body]");
  const scroller = scrolls(body) ? body : scrolls(panel) ? panel : null;
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const footer = [...panel.querySelectorAll<HTMLElement>("[data-panel-footer], [data-panel-footer-fallback]")].map((f) => f.getBoundingClientRect()).find((r) => r.height > 0);
  const top = view.top + 8;
  const bottom = Math.min(view.bottom, footer?.top ?? Infinity) - 8;
  const r = el.getBoundingClientRect();
  // Taller than the space left: show its top.
  if (r.bottom > bottom) scroller.scrollBy({ top: Math.min(r.bottom - bottom, r.top - top) });
  else if (r.top < top) scroller.scrollBy({ top: r.top - top });
}
