// Renders the landing-page demo loop with Remotion (build-time only; Remotion never ships to the browser).
// Usage: node scripts/render-demo.mjs   → public/demo/canvas-demo.{mp4,webm} and canvas-demo-poster.webp
// Uses the Chromium headless shell that ships with the pre-installed Playwright (no browser download).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public/demo");
fs.mkdirSync(out, { recursive: true });
const shell = ["/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell", process.env.REMOTION_BROWSER].find((p) => p && fs.existsSync(p)) ?? null;
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "athena-remotion-"));
fs.copyFileSync(path.join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"), path.join(publicDir, "inter.woff2"));

const serveUrl = await bundle({ entryPoint: path.join(root, "remotion/index.ts"), publicDir });
const common = { serveUrl, browserExecutable: shell, chromeMode: "headless-shell", logLevel: "warn" };
const composition = await selectComposition({ ...common, id: "CanvasDemo" });
const scale = 0.75; // 960×600: sharp enough for the hero, small enough for the LCP budget

await renderMedia({ ...common, composition, codec: "h264", crf: 30, scale, pixelFormat: "yuv420p", outputLocation: path.join(out, "canvas-demo.mp4") });
await renderMedia({ ...common, composition, codec: "vp9", crf: 40, scale, outputLocation: path.join(out, "canvas-demo.webm") });
// The poster (also the reduced-motion image) is the finished canvas.
await renderStill({ ...common, composition, frame: 276, scale, imageFormat: "webp", output: path.join(out, "canvas-demo-poster.webp") });
for (const f of fs.readdirSync(out)) console.log(f, `${Math.round(fs.statSync(path.join(out, f)).size / 1024)} kB`);
