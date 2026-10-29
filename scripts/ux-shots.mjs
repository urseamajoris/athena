// UX screenshots for the 3-second-test loop: every page reachable with no xAI key, in its key states, at 375, 768
// and 1366 px.
// Usage: node scripts/ux-shots.mjs <baseUrl> <version> [--only=page,page] [--widths=375,768,1366] [--theme=dark|light] [--out=dir]
// Needs a server with no xAI key (it reads /api/status first and refuses to run otherwise, so it never spends).
// With the server's ADMIN_EMAIL / ADMIN_PASSWORD in this environment it also shoots the admin dashboard and the
// AI-off state. Seeds its own projects through the API (as a fresh user, without AI), then saves
// <out>/<page>/v<version>/<state>-<width>.jpg (default out: docs/screenshots/ux), <out>/<page>/v<version>/index.json
// with what each shot shows, and <out>/not-covered-v<version>.json with the states that need AI output.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { Client } from "./lib/client.mjs";
import { isAiRefusalLog, requireNoKey } from "./lib/no-key.mjs";
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

// Refuses to go on (exit 2) if the server has an xAI key.
const { status } = await requireNoKey(base);
const hasAdmin = !!status.keys; // only the admin's status carries `keys`
if (!hasAdmin) log("no admin credentials: the admin dashboard and AI-off shots are skipped (set ADMIN_EMAIL / ADMIN_PASSWORD)");

// ---- seed projects through the API, without AI ----
const user = await new Client(base, "ux").signup(EMAIL, PASSWORD);
const call = (pid, p, body, method) => user.json(`/api/projects/${pid}${p ? `/${p}` : ""}`, { body, method });
/** An AI step: with no key the server refuses it (503) before any request to xAI. */
const refused = async (pid, p) => {
  const r = await user.raw(`/api/projects/${pid}/${p}`, { body: {} });
  if (r.status !== 503) throw new Error(`expected ${p} to be refused with no xAI key, got HTTP ${r.status}`);
};
const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
const TOPICS = ["Telemedicine adoption in ASEAN countries", "Barriers and facilitators for health workers", "Rural and underserved patients", "Policy and infrastructure readiness"];
log("seeding projects…");
const P = {};
// The idea, not yet approved.
P.idea = (await user.json("/api/projects", { body: { idea: "I'm interested in sleep and grades in university students" } })).id;
// Idea approved; the first scoping question needs AI, so the panel says AI is not set up.
P.nokey = (await user.json("/api/projects", { body: { idea: IDEA } })).id;
await call(P.nokey, "stages/1/approve", {});
await refused(P.nokey, "scoping/start");
// Questions skipped, topics added by hand, not yet approved.
const withTopics = async (approve) => {
  const pid = (await user.json("/api/projects", { body: { idea: IDEA } })).id;
  await call(pid, "stages/1/approve", {});
  await call(pid, "scoping/skip", {});
  for (const name of TOPICS) await call(pid, "topics", { name });
  if (approve) await call(pid, "stages/2/approve", {});
  return pid;
};
P.topics = await withTopics(false);
// Topics approved; writing the searches needs AI.
P.approved = await withTopics(true);
await refused(P.approved, "search/build");
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
const NOT_SET_UP = /AI is not set up/i;
const SHOTS = [
  { page: "home", state: "landing", who: "anon", url: "/", what: "Landing page for a first-time visitor" },
  { page: "signup", state: "empty", who: "anon", url: "/signup?next=/s/new", what: "Create-account form" },
  { page: "login", state: "error", who: "anon", url: "/login", what: "Log-in form after a wrong password", act: async (p) => { await p.getByLabel("Email").fill("nobody@example.org"); await p.getByLabel("Password").fill("wrong-password-1"); await p.getByRole("button", { name: /log in/i }).click(); await p.getByText(/do not match/).waitFor(); } },
  { page: "projects", state: "populated", url: "/sessions", what: "My projects list (several projects at different steps)" },
  { page: "new", state: "empty", url: "/s/new", what: "Starting a new review: the empty canvas asking for the idea" },
  { page: "idea", state: "draft", url: () => `/s/${P.idea}?node=idea`, what: "The idea before it is approved: it saves itself" },
  { page: "idea", state: "not-set-up", url: () => `/s/${P.nokey}?node=idea`, what: "“Sharpen my idea” with no xAI key: the plain AI-not-set-up message", act: async (p) => { await p.locator("[data-panel]").getByText(NOT_SET_UP).first().waitFor({ timeout: 20_000 }); } },
  { page: "scoping", state: "manual-topics", url: () => `/s/${P.topics}?node=idea`, what: "Questions skipped, topics added by hand, ready to approve" },
  { page: "canvas", state: "topics", url: () => `/s/${P.approved}`, what: "Session overview: the idea and the approved hand-made topics" },
  { page: "search", state: "not-set-up", url: () => `/s/${P.approved}`, what: "“Write the searches” with no xAI key: the AI-not-set-up message", act: async (p) => { await p.locator('[data-kind="topic"]').first().getByRole("button", { name: "Write the searches" }).click(); await p.getByText(NOT_SET_UP).first().waitFor({ timeout: 20_000 }); await p.waitForTimeout(500); } },
  { page: "export", state: "partial", url: () => `/s/${P.approved}/export`, what: "Export of what exists so far, under the “AI is not set up yet.” banner" },
  { page: "account", state: "populated", url: "/account", what: "Account page" },
  { page: "settings", state: "populated", url: "/settings", what: "Settings: how this server runs Athena (AI not set up)" },
  { page: "settings", state: "ai-off", url: "/settings", aiOff: true, what: "Settings while an administrator has switched AI off" },
  { page: "admin", state: "populated", who: "admin", url: "/admin", what: "Admin dashboard (no xAI key)" },
  { page: "admin", state: "ai-off", who: "admin", url: "/admin", aiOff: true, what: "Admin dashboard with AI switched off" },
];
// States the earlier mock mode could show and a server with no key cannot: they need AI output.
const NOT_COVERED = [
  ["idea/chat", "the scoping chat needs AI questions"],
  ["scoping/topics", "suggested (ghost) topics are written by the AI"],
  ["search/review", "the searches are written by the AI"],
  ["retrieval/done", "retrieval needs the AI-written searches"],
  ["summary/review", "summary rows are written by the AI"],
  ["ranking/review, ranking/map", "ranking scores come from the AI"],
  ["appraisal/review", "appraisals are written by the AI"],
  ["synthesis/review, synthesis/network", "the synthesis is written by the AI"],
  ["questions/review", "research questions are written by the AI"],
  ["final/done", "a finished review needs every AI step"],
  ["canvas/mid, canvas/stale", "both need retrieval and later steps"],
].map(([shots, why]) => ({ shots, why }));
const todo = SHOTS.filter((s) => (!ONLY || ONLY.includes(s.page)) && ((s.who !== "admin" && !s.aiOff) || hasAdmin));
const admin = hasAdmin ? await new Client(base, "admin").login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD) : null;
const setAi = (enabled) => admin.json("/api/admin/ai", { body: { enabled } });
try {
  for (const s of todo) {
    const dir = path.join(OUT, s.page, `v${version}`);
    fs.mkdirSync(dir, { recursive: true });
    const indexFile = path.join(dir, "index.json");
    const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
    if (s.aiOff) await setAi(false);
    try {
      for (const w of WIDTHS) {
        const ctx = await context(w, s.who);
        const p = await ctx.newPage();
        // The browser logs every refused AI step (HTTP 503) as a failed resource load: expected here.
        const refusedUrls = new Set();
        const logs = [];
        p.on("response", (r) => r.status() === 503 && r.url().includes("/api/projects/") && refusedUrls.add(r.url()));
        p.on("pageerror", (e) => errors.push(`${s.page}/${s.state}@${w}: ${String(e).slice(0, 200)}`));
        p.on("console", (m) => m.type() === "error" && logs.push({ text: m.text().slice(0, 200), url: m.location()?.url ?? "" }));
        await p.goto(base + (typeof s.url === "function" ? s.url() : s.url), { waitUntil: "networkidle" }).catch(() => {});
        await p.waitForTimeout(1200);
        if (s.act) await s.act(p).catch((e) => errors.push(`${s.page}/${s.state}@${w}: act failed ${e.message}`));
        const file = path.join(dir, `${s.state}-${w}.jpg`);
        await p.screenshot({ path: file, type: "jpeg", quality: 72 });
        index[`${s.state}-${w}`] = { what: s.what, url: typeof s.url === "function" ? s.url().replace(/prj_[a-z0-9]+/, "<project>") : s.url, width: w, theme: THEME, mode: "no-key" };
        for (const l of logs) if (!isAiRefusalLog(l.text, l.url, refusedUrls)) errors.push(`${s.page}/${s.state}@${w}: ${l.text}`);
        await ctx.close();
      }
    } finally {
      if (s.aiOff) await setAi(true);
    }
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    log("✓", s.page, s.state);
  }
} finally {
  await browser.close();
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `not-covered-v${version}.json`), JSON.stringify({ note: "Mock mode was removed. These states need AI output, so they are only reachable on a server with an xAI key (a real run, which spends money).", notCovered: NOT_COVERED }, null, 2));
log(`not covered without a key: ${NOT_COVERED.map((n) => n.shots).join("; ")} → ${path.join(OUT, `not-covered-v${version}.json`)}`);
if (errors.length) console.log(`console errors:\n${errors.join("\n")}`);
else log("no console errors");
