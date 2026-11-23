"use client";
// Its own module (not vt.tsx) so the root layout's client chunk holds only this, not the links' code.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pending } from "./vt-state";

/** Mounted once in the root layout: ends a pending view transition when the new route has rendered. */
export function RouteTransitions() {
  const pathname = usePathname();
  useEffect(() => {
    pending.finish?.();
    pending.finish = null;
  }, [pathname]);
  return null;
}
