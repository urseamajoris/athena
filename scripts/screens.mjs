// Screenshot every stage of a project at laptop width. Usage: node scripts/screens.mjs <projectId> <outDir> [baseUrl]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // uses the pre-installed Playwright (CommonJS resolution honours NODE_PATH)
import fs from "node:fs";
const [pid, out = "e2e-artifacts/screens", base = "http://localhost:3000"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(`[stage ${cur}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => errors.push(`[stage ${cur}] ${String(e).slice(0, 300)}`));
let cur = 0;
for (let n = 1; n <= 9; n++) {
  cur = n;
  await page.goto(`${base}/projects/${pid}?stage=${n}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/stage-${n}.png`, fullPage: n !== 4 });
}
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
await browser.close();
