// Theme preference: dark by default, light as a token swap, or follow the system.
export type ThemePref = "dark" | "light" | "system";
export const THEME_KEY = "athena-theme";

export function resolveTheme(pref: string | null | undefined, systemLight: boolean): "dark" | "light" {
  if (pref === "light") return "light";
  if (pref === "system") return systemLight ? "light" : "dark";
  return "dark";
}

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const themeInitScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});var l=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.dataset.theme=p==='light'||(p==='system'&&l)?'light':'dark';}catch(e){}})();`;

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function applyThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {}
  const light = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = resolveTheme(pref, light);
}
