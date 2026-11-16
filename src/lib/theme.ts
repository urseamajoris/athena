// Theme preference: light by default, dark as a token swap, or follow the device.
export type ThemePref = "dark" | "light" | "system";
export const THEME_KEY = "athena-theme";

export function resolveTheme(pref: string | null | undefined, systemLight: boolean): "dark" | "light" {
  if (pref === "dark") return "dark";
  if (pref === "system") return systemLight ? "light" : "dark";
  return "light";
}

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const themeInitScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});var l=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.dataset.theme=p==='dark'||(p==='system'&&!l)?'dark':'light';}catch(e){}})();`;

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

export function applyThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {}
  const light = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = resolveTheme(pref, light);
}
