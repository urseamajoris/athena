"use client";
// Category shapes as point-sprite textures, drawn from the same SVG paths as the 2D chips and legends,
// so a shape means the same thing in 2D and 3D.
import * as THREE from "three";
import { shapePath } from "../categories";
import type { Shape } from "@/lib/shared/categories";

const cache = new Map<string, THREE.Texture>();
export function shapeTexture(shape: Shape): THREE.Texture {
  const hit = cache.get(shape);
  if (hit) return hit;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.scale(size / 16, size / 16);
  ctx.fillStyle = "#ffffff";
  ctx.fill(new Path2D(shapePath(shape)), "evenodd");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(shape, tex);
  return tex;
}
