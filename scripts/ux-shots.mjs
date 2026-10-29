// UX screenshots for the 3-second-test loop: every page in its key states at 375, 768 and 1366 px.
// Usage: node scripts/ux-shots.mjs <baseUrl> <version> [--only=page,page] [--widths=375,768,1366] [--theme=dark|light] [--out=dir]
// Needs a mock-mode server whose ADMIN_EMAIL / ADMIN_PASSWORD are in this environment. Seeds its own projects
// through the API (as a fresh user), then saves <out>/<page>/v<version>/<state>-<width>.jpg (default out:
// docs/screenshots/ux) and <out>/<page>/v<version>/index.json with what each shot shows.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { Client } from "./lib/client.mjs";
import { runFlow } from "./api-flow.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:3000";
const version = process.argv[3] ?? "1";
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const ONLY = arg("only")?.split(",") ?? null;
const WIDTHS = (arg("widths") ?? "375,768,1366").split(",").map(Number);
const THEME = arg("theme") ?? "dark";
const OUT = arg("out") ?? "docs/screenshots/ux";
const stamp = Date.now();
const EMAIL = `ux-${stamp}@example.org`;
const PASSWORD = "ux-password-123";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- seed projects through the API ----
const user = await new Client(base, "ux").signup(EMAIL, PASSWORD);
const call = (pid, p, body, method) => user.json(`/api/projects/${pid}${p ? `/${p}` : ""}`, { body, method });
const waitStage = async (pid, n, want = ["needs_review"]) => {
  for (let i = 0; i < 400; i++) {
    const v = await call(pid, "");
    if (want.includes(v.project.stageStates[String(n)])) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`stage ${n} did not reach ${want}`);
};
const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
log("seeding projects…");
const P = {};
// Mid-chat: idea approved, first question asked.
P.chat = (await user.json("/api/projects", { body: { idea: "I'm interested in sleep and grades in university students" } })).id;
await call(P.chat, "stages/1/approve", {});
await call(P.chat, "scoping/start", {});
// Topics proposed (ghosts), not approved.
P.topics = (await user.json("/api/projects", { body: { idea: IDEA } })).id;
await call(P.topics, "stages/1/approve", {});
{
  let s = await call(P.topics, "scoping/start", {});
  while (!s.done && s.awaitingAnswer) s = await call(P.topics, "scoping/answer", { text: "Rural patients and health workers in ASEAN; adoption and barriers; 2015 onwards; any design." });
  await call(P.topics, "scoping/topics", {});
}
// Search builder awaiting review.
P.search = (await user.json("/api/projects", { body: { idea: IDEA } })).id;
await call(P.search, "stages/1/approve", {});
await runFlow(user, { project: P.search, until: 2 });
await call(P.search, "search/build", {});
await call(P.search, "search/dryrun-all", {});
// Finished review.
P.done = await runFlow(user, { until: 9 });
// Stale: a finished review whose topics were then edited.
P.stale = await runFlow(user, { until: 9 });
{
  const sc = await call(P.stale, "scoping");
  await call(P.stale, "stages/2/reopen", {});
  await call(P.stale, `topics/${sc.topics[0].id}`, { synonyms: [...sc.topics[0].synonyms, "eHealth"] }, "PATCH");
}
// Stopped at each review point: table (5), ranking (6), appraisal (7), synthesis (8), questions (9).
P.s5 = await runFlow(user, { until: 4 }); // approves 4 → summaries run
await waitStage(P.s5, 5);
P.s6 = await runFlow(user, { until: 5 });
await waitStage(P.s6, 6);
P.s7 = await runFlow(user, { until: 6 });
await waitStage(P.s7, 7);
P.s8 = await runFlow(user, { until: 7 });
await waitStage(P.s8, 8);
P.s9 = await runFlow(user, { until: 8 });
await waitStage(P.s9, 9);
log("seeded", Object.keys(P).join(", "));

// ---- shots ----
const browser = await chromium.launch();
const errors = [];
async function context(width, who = "user") {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : width < 1000 ? 1024 : 900 }, deviceScaleFactor: 1, colorScheme: THEME, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => { try { localStorage.setItem("athena-theme", t); } catch {} }, THEME);
  if (who !== "anon") {
    const c = who === "admin" ? await new Client(base).login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD) : await new Client(base).login(EMAIL, PASSWORD);
    const u = new URL(base);
    await ctx.addCookies([{ name: "athena_session", value: c.cookie.split("=")[1], domain: u.hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  }
  return ctx;
}
const SHOTS = [
  { page: "home", state: "landing", who: "anon", url: "/", what: "Landing page for a first-time visitor" },
  { page: "signup", state: "empty", who: "anon", url: "/signup?next=/s/new", what: "Create-account form" },
  { page: "login", state: "error", who: "anon", url: "/login", what: "Log-in form after a wrong password", act: async (p) => { await p.getByLabel("Email").fill("nobody@example.org"); await p.getByLabel("Password").fill("wrong-password-1"); await p.getByRole("button", { name: /log in/i }).click(); await p.getByRole("alert").waitFor(); } },
  { page: "projects", state: "populated", url: "/sessions", what: "My projects list (several projects at different steps)" },
  { page: "new", state: "empty", url: "/s/new", what: "Starting a new review: the empty canvas asking for the idea" },
  { page: "idea", state: "chat", url: () => `/s/${P.chat}?node=idea`, what: "Scoping chat: the AI asks a clarifying question about the idea" },
  { page: "scoping", state: "topics", url: () => `/s/${P.topics}?node=idea`, what: "Scoping: proposed search topics to accept or edit" },
  { page: "search", state: "review", url: () => `/s/${P.search}?node=search`, what: "Search builder: database queries and dry-run counts to check" },
  { page: "retrieval", state: "done", url: () => `/s/${P.s5}?node=retrieval`, what: "Retrieval finished: papers found and duplicates removed" },
  { page: "summary", state: "review", url: () => `/s/${P.s5}/table`, what: "Summary table: one row per paper, to skim and correct" },
  { page: "ranking", state: "review", url: () => `/s/${P.s6}/table`, what: "Ranking: scored papers with the top ones selected per topic" },
  { page: "appraisal", state: "review", url: () => `/s/${P.s7}?node=appraisal`, what: "Appraisal: checking one paper at a time with verified quotes" },
  { page: "synthesis", state: "review", url: () => `/s/${P.s8}?node=synthesis`, what: "Synthesis: what is known, contested and unknown" },
  { page: "questions", state: "review", url: () => `/s/${P.s9}?node=questions`, what: "Research questions: three candidates to choose from" },
  { page: "final", state: "done", url: () => `/s/${P.done}/export`, what: "Finished review: download the report" },
  { page: "canvas", state: "mid", url: () => `/s/${P.s7}`, what: "Session overview mid-way (step 7 waiting for review)" },
  { page: "canvas", state: "stale", url: () => `/s/${P.stale}?node=summary`, what: "A later step is stale after an earlier edit" },
  { page: "account", state: "populated", url: "/account", what: "Account page" },
  { page: "settings", state: "populated", url: "/settings", what: "Settings" },
  { page: "admin", state: "populated", who: "admin", url: "/admin", what: "Admin dashboard" },
];
const todo = SHOTS.filter((s) => !ONLY || ONLY.includes(s.page));
for (const s of todo) {
  const dir = path.join(OUT, s.page, `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, "index.json");
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
  for (const w of WIDTHS) {
    const ctx = await context(w, s.who);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${s.page}/${s.state}@${w}: ${String(e).slice(0, 200)}`));
    p.on("console", (m) => m.type() === "error" && errors.push(`${s.page}/${s.state}@${w}: ${m.text().slice(0, 200)}`));
    await p.goto(base + (typeof s.url === "function" ? s.url() : s.url), { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(1200);
    if (s.act) await s.act(p).catch((e) => errors.push(`${s.page}: act failed ${e.message}`));
    const file = path.join(dir, `${s.state}-${w}.jpg`);
    await p.screenshot({ path: file, type: "jpeg", quality: 72 });
    index[`${s.state}-${w}`] = { what: s.what, url: typeof s.url === "function" ? s.url().replace(/prj_[a-z0-9]+/, "<project>") : s.url, width: w, theme: THEME };
    await ctx.close();
  }
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
  log("✓", s.page, s.state);
}
await browser.close();
if (errors.length) console.log(`console errors:\n${errors.join("\n")}`);
else log("no console errors");
