// Renders the nine "What happens in this step" explainers with Remotion (build time only; Remotion never ships
// to the browser). Usage: node scripts/render-explainers.mjs [stage...]
// → public/explainers/stage-N.mp4 (640×360, ~8 s, silent) and stage-N.webp (poster: the last beat, also the
// reduced-motion image). Uses the Chromium headless shell that ships with the pre-installed Playwright.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public/explainers");
fs.mkdirSync(out, { recursive: true });
const shell = ["/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell", process.env.REMOTION_BROWSER].find((p) => p && fs.existsSync(p)) ?? null;
const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "athena-remotion-"));
fs.copyFileSync(path.join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"), path.join(publicDir, "inter.woff2"));
const serveUrl = await bundle({ entryPoint: path.join(root, "remotion/index.ts"), publicDir });
const common = { serveUrl, browserExecutable: shell, chromeMode: "headless-shell", logLevel: "warn" };
const stages = process.argv.slice(2).map(Number).filter(Boolean);
for (const n of stages.length ? stages : [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  const composition = await selectComposition({ ...common, id: `Stage${n}` });
  await renderMedia({ ...common, composition, codec: "h264", crf: 32, scale: 0.5, pixelFormat: "yuv420p", outputLocation: path.join(out, `stage-${n}.mp4`) });
  await renderStill({ ...common, composition, frame: 226, scale: 0.5, imageFormat: "webp", output: path.join(out, `stage-${n}.webp`) });
  console.log(`stage ${n}:`, ["mp4", "webp"].map((x) => `${x} ${Math.round(fs.statSync(path.join(out, `stage-${n}.${x}`)).size / 1024)} kB`).join(", "));
}
