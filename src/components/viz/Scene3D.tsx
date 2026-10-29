"use client";
// Shared Three.js canvas: capped frame rate, paused when the tab or the canvas is hidden, static under
// prefers-reduced-motion. Loaded only through next/dynamic (ssr: false), never on first paint.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { PerspectiveCamera, Vector3 } from "three";

/**
 * Where the scene's text labels (drei <Html>) mount: an element of our own over the canvas. Without it, Html
 * first mounts into the canvas container and then moves once the canvas connects its events. R3F mounts the
 * scene inside React's commit, so that move unmounts Html's React root during a render; the unmount is
 * deferred and, when the scene is removed, React tries to remove a node that is already gone ("Failed to
 * execute 'removeChild' on 'Node'"). A fixed target from the first render means Html never moves.
 */
const LabelHost = createContext<RefObject<HTMLElement> | null>(null);

/** A text label at a 3D position (drei <Html>, mounted in the scene's label layer). */
export function Label(props: Omit<ComponentProps<typeof Html>, "portal">) {
  const portal = useContext(LabelHost);
  return <Html {...props} portal={portal ?? undefined} />;
}

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

/** The box the camera must keep in view: half its width and height (world units) around `target`, plus `depth`
 *  in front of it (points nearer the camera look bigger and need room). */
export interface Fit { halfWidth: number; halfHeight: number; depth?: number; target?: [number, number, number] }

/**
 * Moves the camera along its current direction so the whole `fit` box is visible at the canvas's aspect ratio,
 * and again whenever the canvas is resized (a narrower Focus panel, a rotated tablet). Without it a fixed camera
 * distance cuts off the sides of a narrow canvas. The user's turn is kept; only the distance changes.
 */
function FitCamera({ fit }: { fit: Fit }) {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; maxDistance: number; update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const { halfWidth, halfHeight, depth = 0 } = fit;
  const [tx, ty, tz] = fit.target ?? [0, 0, 0];
  useLayoutEffect(() => {
    if (!width || !height || !(camera instanceof PerspectiveCamera)) return;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const distance = Math.max(halfHeight / tan, halfWidth / (tan * (width / height))) + depth;
    const target = new Vector3(tx, ty, tz);
    const dir = camera.position.clone().sub(controls?.target ?? target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    camera.position.copy(target).addScaledVector(dir.normalize(), distance);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(target);
      controls.maxDistance = Math.max(controls.maxDistance, distance * 1.6);
      controls.update();
    }
    invalidate();
  }, [camera, controls, width, height, halfWidth, halfHeight, depth, tx, ty, tz, invalidate]);
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
  /** Keep this box in view at any canvas size (see FitCamera); without it the camera stays where `camera` puts it. */
  fit?: Fit;
}

export default function Scene3D({ children, animate, controls = true, autoRotate = false, camera = [0, 0, 9], fps = 30, className = "", label, pointThreshold = 0.1, fit }: Scene3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  // Only ever rendered on the client (next/dynamic, ssr: false), so the element can exist from the first render.
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
    return el;
  });
  const portal = useRef<HTMLElement>(host);
  useLayoutEffect(() => {
    wrap.current?.appendChild(host);
    return () => host.remove();
  }, [host]);
  return (
    <div ref={wrap} className={`relative ${className}`} role="img" aria-label={label}>
      <LabelHost.Provider value={portal}>
        <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: camera, fov: 45 }} gl={{ antialias: true, powerPreference: "low-power", alpha: true }} raycaster={{ params: { Points: { threshold: pointThreshold } } } as never}>
          <FrameCap fps={fps} animate={animate} />
          <ambientLight intensity={0.9} />
          <directionalLight position={[4, 6, 8]} intensity={0.6} />
          {children}
          {controls && <OrbitControls enablePan={false} autoRotate={animate && autoRotate} autoRotateSpeed={0.4} minDistance={4} maxDistance={18} makeDefault />}
          {fit && <FitCamera fit={fit} />}
        </Canvas>
      </LabelHost.Provider>
    </div>
  );
}
