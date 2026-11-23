// Screenshot every stage of a project at laptop width. Usage: node scripts/screens.mjs <projectId> <outDir> [baseUrl]
// Signs in as SCREENS_EMAIL / SCREENS_PASSWORD (the project's owner) and refuses to run if the server has an xAI
// key: opening a step can start its AI work, which would spend money.
import { createRequire } from "node:module";
import { Client } from "./lib/client.mjs";
import { requireNoKey } from "./lib/no-key.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // uses the pre-installed Playwright (CommonJS resolution honours NODE_PATH)
import fs from "node:fs";
const [pid, out = "e2e-artifacts/screens", base = "http://localhost:3000"] = process.argv.slice(2);
if (!process.env.SCREENS_EMAIL || !process.env.SCREENS_PASSWORD) {
  console.error("Set SCREENS_EMAIL and SCREENS_PASSWORD to the project owner's account.");
  process.exit(2);
}
const owner = await new Client(base, "screens").login(process.env.SCREENS_EMAIL, process.env.SCREENS_PASSWORD);
await requireNoKey(base, owner);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addCookies([{ name: "athena_session", value: owner.cookie.split("=")[1], domain: new URL(base).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
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
