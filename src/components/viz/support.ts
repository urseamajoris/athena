"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

let webgl: boolean | null = null;
/** WebGL available and the device is not obviously weak (else the 2D version is used). */
export function canUse3D(): boolean {
  if (typeof window === "undefined") return false;
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const weak = (nav.hardwareConcurrency ?? 4) <= 2 || (nav.deviceMemory ?? 4) <= 2;
    webgl = !!gl && !weak;
  } catch {
    webgl = false;
  }
  return webgl;
}

const RM = "(prefers-reduced-motion: reduce)";
function sub(cb: () => void) {
  const mq = window.matchMedia(RM);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export const useReducedMotion = () => useSyncExternalStore(sub, () => window.matchMedia(RM).matches, () => true);

/** "3d" | "2d" once mounted (null before: render the 2D version on the server and first paint). */
export function useVizMode(pref: "auto" | "2d" = "auto"): "3d" | "2d" | null {
  const [mode, setMode] = useState<"3d" | "2d" | null>(null);
  useEffect(() => setMode(pref === "2d" ? "2d" : canUse3D() ? "3d" : "2d"), [pref]);
  return mode;
}

/** The current theme ("light" | "dark") from <html data-theme>, live. */
export function useTheme(): "light" | "dark" {
  const [t, setT] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const read = () => setT(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return t;
}
