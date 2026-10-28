"use client";
import type { ReactNode } from "react";
import { LazyMotion, MotionConfig } from "motion/react";

// Animation features load after first paint; reducedMotion="user" turns transforms into plain fades.
const features = () => import("./motion-features").then((m) => m.default);

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={features} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
