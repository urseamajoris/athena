// Whether the last input was the keyboard (not a pointer): focus moved by code then shows a ring; pointer users
// see none. Tracked from the moment this module loads.
let lastInput: "keyboard" | "pointer" = "pointer";
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey) lastInput = "keyboard"; }, true);
  window.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
}
export const usingKeyboard = () => lastInput === "keyboard";

/**
 * Focus an element outside the Tab order (a page title), with a visible ring for keyboard users
 * (globals.css: [data-focus-ring]) that goes away when focus moves on.
 */
export function focusWithRing(el: HTMLElement | null, { reveal = false } = {}) {
  if (!el) return;
  if (usingKeyboard()) {
    el.setAttribute("data-focus-ring", "");
    el.addEventListener("blur", () => el.removeAttribute("data-focus-ring"), { once: true });
  }
  el.focus({ preventScroll: true });
  if (reveal) el.scrollIntoView({ block: "nearest" });
}

/**
 * Scroll a control clear of the sticky action bar at the bottom of a screen. The browser's own scrolling (or a
 * focus with preventScroll) can leave a focused control half hidden behind the bar.
 */
export function revealAboveActionBar(el: HTMLElement | null) {
  if (!el || el.closest("[data-action-bar]")) return;
  const bar = [...document.querySelectorAll<HTMLElement>("[data-action-bar]")].map((b) => b.getBoundingClientRect()).find((r) => r.height > 0);
  const top = (document.querySelector<HTMLElement>("[data-topbar]")?.getBoundingClientRect().bottom ?? 0) + 8;
  const bottom = Math.min(window.innerHeight, bar?.top ?? Infinity) - 8;
  const r = el.getBoundingClientRect();
  // Taller than the space left: show its top.
  if (r.bottom > bottom) window.scrollBy({ top: Math.min(r.bottom - bottom, r.top - top) });
  else if (r.top < top) window.scrollBy({ top: r.top - top });
}
