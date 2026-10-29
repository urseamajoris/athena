"use client";
// Shared Three.js canvas: capped frame rate, paused when the tab or the canvas is hidden, static under
// prefers-reduced-motion. Loaded only through next/dynamic (ssr: false), never on first paint.
import { useEffect, useRef, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

/** Re-renders at most `fps` times a second while animating and visible; otherwise renders on demand only. */
function FrameCap({ fps, animate }: { fps: number; animate: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!animate) return;
    let visible = !document.hidden;
    let inView = true;
    const io = new IntersectionObserver(([e]) => (inView = e.isIntersecting));
    io.observe(gl.domElement);
    const onVis = () => (visible = !document.hidden);
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => visible && inView && invalidate(), 1000 / fps);
    return () => {
      clearInterval(t);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [animate, fps, invalidate, gl]);
  return null;
}

export interface Scene3DProps {
  children: ReactNode;
  /** Animate (auto-rotate etc.). False under reduced motion: one static frame, re-rendered on interaction. */
  animate: boolean;
  /** Let the user orbit and zoom. */
  controls?: boolean;
  autoRotate?: boolean;
  camera?: [number, number, number];
  fps?: number;
  className?: string;
  /** Text alternative for the whole scene (the same information is also shown as text next to it). */
  label: string;
  /** Hit radius for hovering point clouds (world units). */
  pointThreshold?: number;
}

export default function Scene3D({ children, animate, controls = true, autoRotate = false, camera = [0, 0, 9], fps = 30, className = "", label, pointThreshold = 0.1 }: Scene3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrap} className={className} role="img" aria-label={label}>
      <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: camera, fov: 45 }} gl={{ antialias: true, powerPreference: "low-power", alpha: true }} raycaster={{ params: { Points: { threshold: pointThreshold } } } as never}>
        <FrameCap fps={fps} animate={animate} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 8]} intensity={0.6} />
        {children}
        {controls && <OrbitControls enablePan={false} autoRotate={animate && autoRotate} autoRotateSpeed={0.4} minDistance={4} maxDistance={18} makeDefault />}
      </Canvas>
    </div>
  );
}
