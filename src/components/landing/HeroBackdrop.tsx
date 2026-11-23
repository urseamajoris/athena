"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { canUse3D, useReducedMotion, useTheme } from "../viz/support";

const HeroField3D = dynamic(() => import("./HeroField3D"), { ssr: false });

/** The landing backdrop: loads only after the page is idle (never competes with the headline), static under
 *  reduced motion, absent without WebGL. aria-hidden: it carries no information. */
export function HeroBackdrop() {
  const [show, setShow] = useState(false);
  const reduced = useReducedMotion();
  const theme = useTheme();
  useEffect(() => {
    if (!canUse3D()) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const go = () => setShow(true);
    if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 2500 });
    else setTimeout(go, 1200);
  }, []);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]">
      {show && <div className="h-full w-full opacity-70"><HeroField3D theme={theme} animate={!reduced} /></div>}
    </div>
  );
}
