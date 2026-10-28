"use client";
import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";

// domAnimation is loaded with the view (not lazily) so an element never stays at its `initial` style
// if a chunk fails to load. reducedMotion="user" turns transforms into plain fades.
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
