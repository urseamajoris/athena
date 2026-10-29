// Visual-audit QA loop for the canvas redesign.
//
//   npm run build && npx tsx scripts/visual-audit.ts --round=1 [--only=view,view] [--quick] [--skip-lighthouse]
//
// Starts its own production server with no xAI key (XAI_API_KEY, OPENALEX_API_KEY and the other keys are
// stripped from its environment; fresh database, so no key set in a dashboard either), so every AI step is
// refused before any request to xAI and nothing is spent. Seeds the states reachable without AI (empty canvas,
// idea, the AI-not-set-up state, topics added by hand, AI switched off, account, settings, admin), screenshots
// every view and panel at 1440×900 and 390×844, dark and light, reduced motion on and off, scores the 12-item
// checklist and writes qa/report-<round>.md (+ .json) and qa/shots/<round>/. Views that need AI output (the
// scoping chat, searches, papers, appraisals, synthesis, questions, the 300-node session) are listed in the
// report as not covered.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { chromium } = require("playwright") as Any; // the pre-installed Playwright (NODE_PATH)
const { AxeBuilder } = require("@axe-core/playwright") as Any;

// ---------------------------------------------------------------- options
const arg = (k: string, d?: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? (process.argv.includes(`--${k}`) ? "true" : d);
const ROUND = arg("round", "1")!;
const ONLY = arg("only")?.split(",") ?? null;
const LH_ONLY = arg("lh")?.split(",") ?? null; // Lighthouse only these pages (iteration)
const QUICK = arg("quick") === "true"; // desktop dark only (fast iteration)
const SKIP_LH = arg("skip-lighthouse") === "true" || (QUICK && !arg("lh"));
const PORT = Number(arg("port", "3210"));
const ROOT = process.cwd(); // run from the repository root (npm run qa)
const BASE = `http://localhost:${PORT}`;
const SHOTS = path.join(ROOT, "qa/shots", ROUND);
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = "/opt/pw-browsers/chromium";

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

// ---------------------------------------------------------------- server (no keys)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athena-audit-"));
const DB = path.join(tmp, "audit.db");
let server: ChildProcess;
// Accounts: the audit runs as this server's first admin (created from these env vars), so /api/status shows the
// paid-call counters. Every API call and every browser context carries its session cookie.
const AUDIT_ADMIN = { email: "audit-admin@example.org", password: "visual-audit-password-1" };
let COOKIE = "";
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(AUDIT_ADMIN) });
  const c = (r.headers.getSetCookie?.() ?? []).find((x) => x.startsWith("athena_session="));
  if (!r.ok || !c) throw new Error(`audit login failed: HTTP ${r.status}`);
  COOKIE = c.split(";")[0];
}

async function startServer() {
  if (!fs.existsSync(path.join(ROOT, ".next/BUILD_ID"))) throw new Error("No production build: run `npm run build` first.");
  const taken = await fetch(`${BASE}/api/status`).then(() => true).catch(() => false);
  if (taken) throw new Error(`Port ${PORT} is already in use; stop that server or pass --port=`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // Set empty rather than deleted: Next.js fills unset variables from .env files, so a deleted key could come back.
  for (const k of ["XAI_API_KEY", "OPENALEX_API_KEY", "NCBI_API_KEY", "CONTACT_EMAIL", "SETTINGS_ENCRYPTION_KEY", "ATHENA_ENV", "SIMULATE_SOURCE_FAILURE"]) env[k] = "";
  env.DATABASE_PATH = DB;
  env.ADMIN_EMAIL = AUDIT_ADMIN.email;
  env.ADMIN_PASSWORD = AUDIT_ADMIN.password;
  // Run Next directly in its own process group so the whole server is stopped at the end (npx would orphan it).
  server = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: ROOT, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stderr?.on("data", (d) => process.env.AUDIT_VERBOSE && process.stderr.write(d));
  for (let i = 0; i < 60; i++) {
    try {
      if (!COOKIE) await login();
      const s = await (await fetch(`${BASE}/api/status`, { headers: { cookie: COOKIE } })).json();
      // The same rule as scripts/lib/no-key.mjs: never audit a server that could call xAI.
      if (s.keys?.xai !== false || s.ai?.keyMissing !== true || s.production) throw new Error(`refusing to audit: the server has an xAI key or does not report that it has none (${JSON.stringify({ keys: s.keys, ai: s.ai, production: s.production })})`);
      return s;
    } catch (e) {
      if (String(e).includes("refusing")) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("server did not start");
}

// ---------------------------------------------------------------- fixtures (through the real API, without AI)
const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
const TOPICS = [
  { name: "Telemedicine adoption in ASEAN countries", synonyms: ["telehealth", "teleconsultation"], rationale: "The main phenomenon." },
  { name: "Barriers and facilitators for health workers", synonyms: ["obstacles", "enablers"], rationale: "What blocks or helps it." },
  { name: "Rural and underserved patients", synonyms: ["remote areas"], rationale: "The population that matters most." },
  { name: "Policy and infrastructure readiness", synonyms: ["regulation", "digital infrastructure"], rationale: "What a health system needs first." },
];
async function call<T = Any>(pid: string, p: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(`${BASE}/api/projects${pid ? `/${pid}` : ""}${p ? `/${p}` : ""}`, { method: method ?? (body ? "POST" : "GET"), headers: { cookie: COOKIE, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method ?? (body ? "POST" : "GET")} ${pid}/${p} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : (null as T);
}
const create = async (idea = IDEA) => (await call<{ id: string }>("", "", { idea })).id;
/** An AI step: with no key the server refuses it (503) before any request to xAI. */
async function refused(pid: string, p: string) {
  const r = await fetch(`${BASE}/api/projects/${pid}/${p}`, { method: "POST", headers: { cookie: COOKIE, "content-type": "application/json" }, body: "{}" });
  if (r.status !== 503) throw new Error(`expected ${p} to be refused with no xAI key, got HTTP ${r.status}`);
}
/** Idea approved, questions skipped, topics added by hand (and approved). */
async function topicsByHand(pid: string, approve: boolean) {
  await call(pid, "stages/1/approve", {});
  await call(pid, "scoping/skip", {});
  for (const t of TOPICS) await call(pid, "topics", t);
  if (approve) await call(pid, "stages/2/approve", {});
}
async function setAi(enabled: boolean) {
  const r = await fetch(`${BASE}/api/admin/ai`, { method: "POST", headers: { cookie: COOKIE, "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
  if (!r.ok) throw new Error(`switching AI ${enabled ? "on" : "off"} failed: HTTP ${r.status}`);
}

interface Fixtures { [k: string]: string }
async function seed(): Promise<{ F: Fixtures; ids: Record<string, string>; pins: Record<string, string[]> }> {
  const F: Fixtures = {};
  const ids: Record<string, string> = {};
  F.idea = await create();
  // Idea approved; the first scoping question needs AI, so the panel says AI is not set up.
  F.nokey = await create();
  await call(F.nokey, "stages/1/approve", {});
  await refused(F.nokey, "scoping/start");
  F.topics = await create();
  await topicsByHand(F.topics, false);
  // Topics approved; writing the searches needs AI.
  F.approved = await create();
  await topicsByHand(F.approved, true);
  await refused(F.approved, "search/build");
  const firstTopic = async (pid: string) => (await call(pid, "scoping")).topics[0].id;
  ids.topic = await firstTopic(F.topics);
  ids.approvedTopic = await firstTopic(F.approved);
  return { F, ids, pins: {} };
}

/** Views and checks that need AI output: a server with no key cannot reach them (listed in the report). */
const NOT_COVERED = [
  "panel-idea-scoping (the scoping chat: AI questions)",
  "canvas-ghosts, panel-topic-ghost (topics suggested by the AI)",
  "panel-query (searches written by the AI)",
  "canvas-running, panel-corpus-running (retrieval needs the searches)",
  "canvas-error, panel-table-error (summary rows are AI output)",
  "canvas-done, panel-appraisal, panel-synthesis, panel-questions, panel-export, panel-quote (a finished review)",
  "canvas-stale (needs retrieval and later steps)",
  "table (papers, summaries and ranking)",
  "canvas-300 and item 10's 300-node pan at ≥ 55 fps (the 300 nodes are pinned quotes from appraisals)",
];

// ---------------------------------------------------------------- views
interface View { name: string; path: string; ready: string; anon?: boolean; noPrimary?: boolean; pins?: string; list?: string; canvasOnly?: boolean; aiOff?: boolean }
function views(F: Fixtures, ids: Record<string, string>): View[] {
  const s = (k: string, q = "") => `/s/${F[k]}${q}`;
  return [
    { name: "landing", path: "/", ready: "h1", anon: true },
    { name: "sessions", path: "/sessions", ready: "h1" },
    { name: "settings", path: "/settings", ready: "#run-title", noPrimary: true },
    { name: "canvas-empty", path: "/s/new", ready: "#idea" },
    { name: "canvas-idea", path: s("idea"), ready: "[data-node-id],[data-list-node]" },
    { name: "panel-idea", path: s("idea", "?node=idea"), ready: "[data-panel]" },
    { name: "canvas-not-set-up", path: s("nokey"), ready: "[data-node-id],[data-list-node]" },
    { name: "panel-idea-not-set-up", path: s("nokey", "?node=idea"), ready: "[data-panel]", noPrimary: true },
    { name: "canvas-topics", path: s("topics"), ready: "[data-node-id],[data-list-node]" },
    { name: "panel-idea-topics", path: s("topics", "?node=idea"), ready: "[data-panel]" },
    { name: "panel-topic", path: s("topics", `?node=topic:${ids.topic}`), ready: "[data-panel]", noPrimary: true },
    { name: "canvas-approved", path: s("approved"), ready: "[data-node-id],[data-list-node]" },
    { name: "panel-topic-search", path: s("approved", `?node=topic:${ids.approvedTopic}`), ready: "[data-panel]" },
    { name: "list-view", path: s("approved"), ready: "[data-list-node]", list: F.approved },
    { name: "export-page", path: s("approved", "/export"), ready: "main [aria-label=\"Report preview\"]" },
    { name: "account", path: "/account", ready: "h1", noPrimary: true },
    { name: "admin", path: "/admin", ready: "h1", noPrimary: true },
    { name: "settings-ai-off", path: "/settings", ready: "#run-title", noPrimary: true, aiOff: true },
    { name: "admin-ai-off", path: "/admin", ready: "h1", noPrimary: true, aiOff: true },
  ].filter((v) => !ONLY || ONLY.includes(v.name));
}

// ---------------------------------------------------------------- in-page checks
/* The following functions run inside the browser (serialised by Playwright), so they are self-contained. */
const PAGE_CHECKS = () => {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return false;
    if (el.closest("[aria-hidden=true]") && !el.closest("[data-node-id]")) return false;
    let p: Element | null = el;
    while (p) {
      const s = getComputedStyle(p);
      if (Number(s.opacity) < 0.05 || s.display === "none" || s.visibility === "hidden") return false;
      p = p.parentElement;
    }
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3 && r.left < innerWidth * 1.5;
  };
  const rgb = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c: { r: number; g: number; b: number }) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a: Any, b: Any) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const desc = (el: Element) => {
    const t = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 48);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${t ? ` "${t}"` : ""}`;
  };
  // Resolve the accent colour as the browser computes it.
  // Two probes, each resolved once: changing one probe's colour would start a transition (reduced motion
  // still has 0.01 ms transitions) and read back the old colour.
  const probeOf = (v: string) => {
    const p = document.createElement("div");
    p.style.cssText = `background:var(${v});transition:none`;
    document.body.appendChild(p);
    const c = getComputedStyle(p).backgroundColor;
    p.remove();
    return c;
  };
  const accent = probeOf("--accent");
  const page = rgb(probeOf("--bg-0"))!;
  const all = [...document.querySelectorAll("body *")].filter(vis);

  // 1–2: accent-filled elements; squint test (the accent block is the highest-contrast filled block).
  const accentEls = all.filter((el) => getComputedStyle(el).backgroundColor === accent);
  let maxOther = 0;
  let maxOtherDesc = "";
  for (const el of all) {
    const c = rgb(getComputedStyle(el).backgroundColor);
    if (!c || c.a < 0.9) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 500 || el.tagName === "IMG" || el.tagName === "VIDEO") continue;
    if (getComputedStyle(el).backgroundColor === accent) continue;
    const k = ratio(c, page);
    if (k > maxOther) {
      maxOther = k;
      maxOtherDesc = desc(el);
    }
  }
  const accentRatio = ratio(rgb(accent)!, page);

  // 3: nothing expanded by default.
  const expanded = [...document.querySelectorAll("[data-collapsible][data-state=open], details[open]")].map(desc);

  // 8: state badges carry an icon and text.
  const badges = [...document.querySelectorAll("[data-state-badge]")].filter(vis);
  const colourOnly = badges.filter((b) => !(b.querySelector("svg,[role=progressbar]") && (b.textContent ?? "").trim().length > 0)).map(desc);
  const cards = [...document.querySelectorAll("[data-node-id]")].filter(vis);
  const cardsWithoutBadge = cards.filter((c) => !c.querySelector("[data-state-badge]")).map(desc);

  // 9: type sizes and 4-pt spacing.
  const sizes = new Set<number>();
  const offGrid: string[] = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || cs.clip !== "auto" || el.closest(".sr-only")) continue;
    if ([...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) sizes.add(Math.round(parseFloat(cs.fontSize)));
    const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
    const autoX = /(^|\s)(m|mx|ml|mr)-auto(\s|$)/.test(cls) || el.tagName === "DIALOG";
    const autoY = /(^|\s)(m|my|mt|mb)-auto(\s|$)/.test(cls);
    const props = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "rowGap", "columnGap", ...(autoY ? [] : ["marginTop", "marginBottom"]), ...(autoX ? [] : ["marginLeft", "marginRight"])] as const;
    for (const p of props) {
      const v = parseFloat((cs as Any)[p]);
      if (!Number.isFinite(v) || v === 0) continue;
      const m = Math.abs(v) % 4;
      if (m > 0.5 && m < 3.5) {
        offGrid.push(`${desc(el)} ${p}=${v}px`);
        break;
      }
    }
  }

  // 12 (partly): text-size and spacing summaries returned to Node.
  return {
    accentCount: accentEls.length,
    accentDesc: accentEls.map(desc),
    accentAboveFold: accentEls.every((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }),
    accentRatio,
    maxOther,
    maxOtherDesc,
    expanded,
    colourOnly,
    cardsWithoutBadge,
    sizes: [...sizes].sort((a, b) => a - b),
    offGrid: offGrid.slice(0, 20),
    offGridCount: offGrid.length,
  };
};

/** 7: mobile layout (390 px): overflow, interactive overlap, tap targets. */
const MOBILE_CHECKS = () => {
  const out = { overflow: 0, outside: [] as string[], small: [] as string[], overlap: [] as string[] };
  const doc = document.documentElement;
  out.overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - innerWidth;
  const desc = (el: Element) => `${el.tagName.toLowerCase()} "${((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    let p: Element | null = el;
    while (p) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.05) return false;
      p = p.parentElement;
    }
    return r.bottom > 0 && r.top < innerHeight;
  };
  const scroller = (el: Element) => {
    let p = el.parentElement;
    while (p) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) || p.classList.contains("react-flow")) return true;
      p = p.parentElement;
    }
    return false;
  };
  const onTop = (el: Element) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el) || !!hit.closest("label")?.contains(el));
  };
  const interactive = [...document.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=tab], [role=menuitem], [role=switch], [role=radio], [tabindex='0']")].filter(visible).filter((el) => !el.closest(".sr-only") && !el.closest("[aria-hidden=true]") && onTop(el));
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 && !scroller(el)) out.outside.push(desc(el));
    // Inline links inside running text are exempt (WCAG 2.5.8); checkboxes and radios are measured by their label.
    const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
    const box = (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label")) || el;
    const b = box.getBoundingClientRect();
    if (!inline && (b.width < 44 - 0.5 || b.height < 44 - 0.5)) out.small.push(`${desc(el)} ${Math.round(b.width)}×${Math.round(b.height)}`);
  }
  // The part of an element actually on screen: its box clipped by every ancestor that clips its content (a
  // scrolled panel body ends where the panel footer starts, even though the content box runs on underneath).
  const clipped = (el: Element) => {
    const r = el.getBoundingClientRect();
    let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = p.getBoundingClientRect();
      [l, t, rr, b] = [Math.max(l, c.left), Math.max(t, c.top), Math.min(rr, c.right), Math.min(b, c.bottom)];
    }
    return { left: l, top: t, right: rr, bottom: b };
  };
  const rects = interactive.map((el) => ({ el, r: clipped(el) }));
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 2 && h > 2) out.overlap.push(`${desc(a.el)} ∩ ${desc(b.el)}`);
    }
  out.small = out.small.slice(0, 15);
  out.overlap = out.overlap.slice(0, 10);
  return out;
};

/** 6: with reduced motion, nothing loops and nothing moves by transform. */
const MOTION_CHECKS = async () => {
  const anims = document.getAnimations().filter((a) => a.playState === "running" || a.pending);
  const loops = anims.filter((a) => a.effect?.getTiming().iterations === Infinity).map((a) => (a as CSSAnimation).animationName || "animation");
  const transforms = anims.filter((a) => (a.effect as KeyframeEffect | null)?.getKeyframes().some((k) => "transform" in k || "translate" in k || "scale" in k)).map((a) => (a as CSSAnimation).animationName || "transform");
  const snap = () => [...document.querySelectorAll("body *")].slice(0, 4000).map((el) => getComputedStyle(el).transform).join("|");
  const before = snap();
  await new Promise((r) => setTimeout(r, 250));
  const moved = before !== snap();
  const playing = [...document.querySelectorAll("video")].filter((v) => !(v as HTMLVideoElement).paused).length;
  return { loops, transforms, moved, playing };
};

// ---------------------------------------------------------------- the audit
interface Shot { view: string; size: "d" | "m"; theme: "dark" | "light"; motion: "on" | "reduced"; file: string }
type Result = { item: number; ok: boolean; where: string; msg: string };
const results: Result[] = [];
const fail = (item: number, where: string, msg: string) => results.push({ item, ok: false, where, msg });
const pass = (item: number, where: string, msg = "") => results.push({ item, ok: true, where, msg });
const metrics: Record<string, unknown> = {};
const consoleErrors: string[] = [];
const externalRequests: string[] = [];

async function settle(page: Any) {
  await page.waitForTimeout(500);
  await page
    .evaluate(() =>
      Promise.race([
        Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
        new Promise((r) => setTimeout(r, 2000)),
      ]),
    )
    .catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(150);
}

function clientState(pins: Record<string, string[]>, v: View) {
  const sessions: Record<string, unknown> = {};
  const base = { pinned: {}, acceptedTopics: [], pinnedQuotes: [], reviewed: [], view: null, minimap: false, cascade: false, viewport: null };
  for (const [pid, list] of Object.entries(pins)) sessions[pid] = { ...base, pinnedQuotes: list };
  if (v.list) sessions[v.list] = { ...(sessions[v.list] as object), ...base, pinnedQuotes: pins[v.list] ?? [], view: "list" };
  return JSON.stringify({ state: { sessions }, version: 1 });
}

async function tabWalk(page: Any, where: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  const noRing: string[] = [];
  let stuck = 0;
  let last = "";
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || /(rgb|#)/.test(cs.boxShadow);
      const id = `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 40)}:${Math.round(el.getBoundingClientRect().top)}`;
      return { id, ring, focusVisible: el.matches(":focus-visible") };
    });
    if (!info) break; // reached the end of the page (focus left the document)
    if (info.id === last) stuck++;
    else stuck = 0;
    last = info.id;
    if (stuck >= 2) break;
    if (!info.ring) noRing.push(info.id);
    if (seen.includes(info.id) && seen[0] === info.id) break; // wrapped around
    seen.push(info.id);
  }
  if (stuck >= 2) fail(5, where, `focus is stuck on ${last}`);
  else if (noRing.length) fail(5, where, `no visible focus ring on: ${[...new Set(noRing)].slice(0, 5).join("; ")}`);
  else pass(5, where, `${seen.length} tab stops`);
}

async function listMatchesGraph(browser: Any, path_: string, pins: string, where: string) {
  const ctx = await newContext(browser, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((s: string) => localStorage.setItem("athena-canvas", s), pins);
  const page = await ctx.newPage();
  await page.goto(BASE + path_);
  await page.locator("[data-node-id]").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  const graphIds: string[] = await page.$$eval("[data-node-id]", (els: Element[]) => els.map((e) => e.getAttribute("data-node-id")!).sort());
  await page.keyboard.press("l");
  await page.locator("[data-list-node]").first().waitFor();
  const listIds: string[] = await page.$$eval("[data-list-node]", (els: Element[]) => els.map((e) => e.getAttribute("data-list-node")!).sort());
  await ctx.close();
  const same = graphIds.length === listIds.length && graphIds.every((x, i) => x === listIds[i]);
  if (same) pass(10, where, `List view shows the same ${listIds.length} nodes as the canvas`);
  else fail(10, where, `canvas has ${graphIds.length} nodes, list has ${listIds.length}`);
  return graphIds.length;
}

async function bundleSize(browser: Any, path_: string) {
  // Times are taken inside the page: when the first canvas node is visible, and when each script finished
  // (Resource Timing). "Initial" = scripts that finished before that first node; encodedBodySize is the
  // gzip-compressed size as served by next start.
  const ctx = await newContext(browser, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    const w = window as Any;
    const poll = () => {
      const el = document.querySelector("[data-node-id]");
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 0 && getComputedStyle(el).visibility !== "hidden") w.__firstNodeAt = performance.now();
      else requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  const page = await ctx.newPage();
  await page.goto(BASE + path_);
  await page.waitForFunction(() => (window as Any).__firstNodeAt, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const at = (window as Any).__firstNodeAt as number;
    const js = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((e) => /\.js(\?|$)/.test(e.name));
    return { at, js: js.map((e) => ({ url: e.name, size: e.encodedBodySize, end: e.responseEnd })) };
  });
  await ctx.close();
  const kb = (n: number) => Math.round(n / 1024);
  const initial = r.js.filter((j: Any) => j.end <= r.at);
  const lazy = r.js.filter((j: Any) => j.end > r.at);
  metrics.canvasJs = { firstNodeMs: Math.round(r.at), initialGzipKb: kb(initial.reduce((a: number, j: Any) => a + j.size, 0)), totalGzipKb: kb(r.js.reduce((a: number, j: Any) => a + j.size, 0)), lazyChunks: lazy.map((j: Any) => `${path.basename(j.url)} ${kb(j.size)}kB`) };
  return metrics.canvasJs;
}

function lighthouse(url: string, name: string) {
  const out = path.join(tmp, `lh-${name}.json`);
  try {
    execFileSync(path.join(ROOT, "node_modules/.bin/lighthouse"), [url, "--quiet", "--output=json", `--output-path=${out}`, "--only-categories=performance,accessibility", "--chrome-flags=--headless=new --no-sandbox --disable-gpu", ...(new URL(url).pathname === "/" ? [] : [`--extra-headers=${JSON.stringify({ Cookie: COOKIE })}`])], { env: { ...process.env, CHROME_PATH: CHROME }, stdio: "ignore", timeout: 180000 });
    const r = JSON.parse(fs.readFileSync(out, "utf8"));
    fs.mkdirSync(path.join(ROOT, "qa/lh"), { recursive: true });
    fs.copyFileSync(out, path.join(ROOT, `qa/lh/${ROUND}-${name}.json`));
    return { performance: Math.round(r.categories.performance.score * 100), accessibility: Math.round(r.categories.accessibility.score * 100), lcpMs: Math.round(r.audits["largest-contentful-paint"].numericValue), tbtMs: Math.round(r.audits["total-blocking-time"].numericValue), cls: r.audits["cumulative-layout-shift"].numericValue, failedA11y: Object.values(r.audits).filter((a: Any) => a.score === 0 && r.categories.accessibility.auditRefs.some((x: Any) => x.id === a.id)).map((a: Any) => a.id), lcpElement: lcpElement(r), shifts: shifts(r) };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

function lcpElement(r: Any): string | undefined {
  // Lighthouse 13 reports the LCP element in the LCP breakdown insight (a "node" item).
  const items: Any[] = r.audits["lcp-breakdown-insight"]?.details?.items ?? r.audits["largest-contentful-paint-element"]?.details?.items ?? [];
  const node = items.find((i) => i.type === "node") ?? items[0]?.items?.[0]?.node;
  return node?.snippet?.slice(0, 160);
}
function shifts(r: Any): string[] {
  const items = r.audits["layout-shifts"]?.details?.items ?? [];
  return items.slice(0, 3).map((i: Any) => `${(i.score ?? 0).toFixed(3)} ${i.node?.snippet?.slice(0, 120) ?? ""}`);
}

/** esbuild (via tsx) wraps named functions in __name(); define it in every page so page.evaluate works. */
const NAME_SHIM = "window.__name = window.__name || ((f) => f);";
async function newContext(browser: Any, opts: Any, anon = false) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(NAME_SHIM);
  if (!anon) await ctx.addCookies([sessionCookie()]);
  return ctx;
}
function sessionCookie() {
  return { name: "athena_session", value: COOKIE.slice(COOKIE.indexOf("=") + 1), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" as const };
}

async function main() {
  const status = await startServer();
  log("server ready with no xAI key; keys present to the server:", JSON.stringify(status.keys));
  const { F, ids, pins } = await seed();
  log("fixtures seeded", JSON.stringify(F));
  const V = views(F, ids);
  const browser = await chromium.launch();
  const shots: Shot[] = [];
  const variants = QUICK
    ? [{ size: "d", theme: "dark", motion: "on" }]
    : (["d", "m"] as const).flatMap((size) => (["dark", "light"] as const).flatMap((theme) => (["on", "reduced"] as const).map((motion) => ({ size, theme, motion }))));

  for (const vr of variants as Shot[]) {
    const ctx = await newContext(browser, {
      viewport: vr.size === "d" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
      ...(vr.size === "m" ? { isMobile: true, hasTouch: true } : {}),
      reducedMotion: vr.motion === "reduced" ? "reduce" : "no-preference",
      colorScheme: vr.theme,
    });
    await ctx.addInitScript((t: string) => localStorage.setItem("athena-theme", t), vr.theme);
    for (const v of V) {
      const tag = `${v.name} ${vr.size === "d" ? "1440" : "390"} ${vr.theme} motion-${vr.motion}`;
      // The landing page is for visitors: a signed-in browser is sent on to /sessions.
      if (v.anon) await ctx.clearCookies();
      else await ctx.addCookies([sessionCookie()]);
      const page = await ctx.newPage();
      await page.addInitScript((s: string) => localStorage.setItem("athena-canvas", s), clientState(pins, v));
      // The browser logs every refused AI step (HTTP 503) as a failed resource load: expected with no key, so those
      // are left out (checked when the view closes, after both events have arrived).
      const refusedUrls = new Set<string>();
      const logs: { text: string; url: string }[] = [];
      page.on("response", (r: Any) => r.status() === 503 && r.url().includes("/api/projects/") && refusedUrls.add(r.url()));
      page.on("console", (m: Any) => m.type() === "error" && logs.push({ text: m.text().slice(0, 160), url: m.location()?.url ?? "" }));
      page.on("pageerror", (e: Any) => consoleErrors.push(`${tag}: ${String(e).slice(0, 160)}`));
      page.on("request", (r: Any) => {
        const u = new URL(r.url());
        if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("data") && !u.protocol.startsWith("blob")) externalRequests.push(`${tag}: ${r.url()}`);
      });
      try {
        if (v.aiOff) await setAi(false);
        await page.goto(BASE + v.path);
        await page.locator(v.ready).first().waitFor({ timeout: 60000 });
        await page.waitForFunction(() => !document.querySelector("[data-panel] [aria-label=Loading], main > [aria-label=Loading]"), null, { timeout: 30000 }).catch(() => {});
        await settle(page);
        const file = path.join(SHOTS, `${v.name}__${vr.size === "d" ? "1440" : "390"}-${vr.theme}-${vr.motion}.png`);
        await page.screenshot({ path: file });
        shots.push({ ...vr, view: v.name, file });

        const c = await page.evaluate(PAGE_CHECKS);
        // 1: one accent-filled element, above the fold (none on views whose mission has no button).
        if (v.noPrimary ? c.accentCount <= 1 : c.accentCount === 1) {
          if (c.accentCount && !c.accentAboveFold) fail(1, tag, `primary below the fold: ${c.accentDesc[0]}`);
          else pass(1, tag);
        } else fail(1, tag, `${c.accentCount} accent-filled elements: ${c.accentDesc.join(", ")}`);
        // 2: squint test.
        if (c.accentCount === 0 || c.accentRatio + 0.01 >= c.maxOther) pass(2, tag);
        else fail(2, tag, `${c.maxOtherDesc} (contrast ${c.maxOther.toFixed(2)}) outshines the primary (${c.accentRatio.toFixed(2)})`);
        // 3: collapsed by default.
        if (c.expanded.length) fail(3, tag, `expanded by default: ${c.expanded.join(", ")}`);
        else pass(3, tag);
        // 8: status never colour-only.
        if (c.colourOnly.length || c.cardsWithoutBadge.length) fail(8, tag, `colour-only state: ${[...c.colourOnly, ...c.cardsWithoutBadge].slice(0, 4).join(", ")}`);
        else pass(8, tag);
        // 9: 4-pt grid and at most 3 type sizes.
        if (c.sizes.length > 3) fail(9, tag, `${c.sizes.length} type sizes: ${c.sizes.join("/")}px`);
        else if (c.offGridCount) fail(9, tag, `${c.offGridCount} off-grid spacings, e.g. ${c.offGrid.slice(0, 3).join("; ")}`);
        else pass(9, tag);
        // 4: axe (serious/critical) — once per size/theme, on the reduced-motion pass (static page).
        if (vr.motion === "reduced" || QUICK) {
          const ax = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
          const bad = ax.violations.filter((x: Any) => x.impact === "serious" || x.impact === "critical");
          if (bad.length) fail(4, tag, bad.map((x: Any) => `${x.id} (${x.nodes.length}: ${x.nodes.slice(0, 2).map((n: Any) => n.target.join(" ")).join(" | ")})`).join("; "));
          else pass(4, tag);
        }
        // 6: reduced motion.
        if (vr.motion === "reduced") {
          const m = await page.evaluate(MOTION_CHECKS);
          if (m.loops.length || m.transforms.length || m.moved || m.playing) fail(6, tag, `loops: ${m.loops.join(",") || "-"}; transform animations: ${m.transforms.join(",") || "-"}; moved: ${m.moved}; videos playing: ${m.playing}`);
          else pass(6, tag);
        }
        // 7: mobile layout.
        if (vr.size === "m") {
          const m = await page.evaluate(MOBILE_CHECKS);
          const problems = [m.overflow > 1 ? `page scrolls sideways by ${m.overflow}px` : "", m.outside.length ? `off-screen: ${m.outside.slice(0, 3).join(", ")}` : "", m.small.length ? `tap targets under 44px: ${m.small.slice(0, 4).join(", ")}` : "", m.overlap.length ? `overlap: ${m.overlap.slice(0, 2).join(", ")}` : ""].filter(Boolean);
          if (problems.length) fail(7, tag, problems.join("; "));
          else pass(7, tag);
        }
        // 5: keyboard — tab through the whole view (dark, motion on, both sizes).
        if (vr.theme === "dark" && vr.motion === "on") await tabWalk(page, tag);
      } catch (e) {
        fail(12, tag, `view failed to load: ${String(e).split("\n")[0]}`);
      } finally {
        if (v.aiOff) await setAi(true).catch((e) => fail(12, tag, String(e)));
        for (const l of logs) if (!(/status of 503/.test(l.text) && refusedUrls.has(l.url))) consoleErrors.push(`${tag}: ${l.text}`);
        await page.close();
      }
    }
    await ctx.close();
    log(`variant ${vr.size}/${vr.theme}/${vr.motion} done`);
  }

  // 10: List view = graph (the 300-node pan needs AI output: see NOT_COVERED). 11: canvas JS before the first node.
  if (!ONLY || ONLY.includes("canvas-approved")) {
    metrics.canvasNodes = await listMatchesGraph(browser, `/s/${F.approved}`, clientState(pins, { name: "", path: "", ready: "" }), "canvas-approved");
    const b = (await bundleSize(browser, `/s/${F.approved}`)) as Any;
    if (b.initialGzipKb < 250) pass(11, "canvas route JS", `${b.initialGzipKb} kB gzip before the first node shows`);
    else fail(11, "canvas route JS", `${b.initialGzipKb} kB gzip before the first node shows (budget 250)`);
  }
  await browser.close();

  // 11: Lighthouse (mobile emulation, the default).
  if (!SKIP_LH) {
    const pages: Record<string, string> = { landing: "/", sessions: "/sessions", settings: "/settings", "canvas-empty": "/s/new", "canvas-approved": `/s/${F.approved}`, "export-page": `/s/${F.approved}/export` };
    const lh: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(pages)) {
      if (LH_ONLY && !LH_ONLY.includes(name)) continue;
      // Three runs, median performance (Lighthouse's advice for variable machines); accessibility must be 100
      // in every run.
      await fetch(BASE + p, { headers: { cookie: COOKIE } }).catch(() => {}); // warm the server's route first (a running server is warm)
      const runs = [0, 1, 2].map(() => lighthouse(BASE + p, name) as Any);
      const ok = runs.filter((x) => !x.error).sort((x, y) => x.performance - y.performance);
      const r = ok.length ? { ...ok[Math.floor((ok.length - 1) / 2)], accessibility: Math.min(...ok.map((x) => x.accessibility)), runs: ok.map((x) => x.performance) } : runs[0];
      lh[name] = r;
      log("lighthouse", name, JSON.stringify(r));
      if (r.error) fail(11, name, r.error);
      else if (name === "landing" && r.lcpMs >= 2000) fail(11, name, `LCP ${r.lcpMs} ms (budget 2000)`);
      else if (r.performance >= 90 && r.accessibility === 100) pass(11, name, `performance ${r.performance}, accessibility ${r.accessibility}, LCP ${r.lcpMs} ms`);
      else fail(11, name, `performance ${r.performance}, accessibility ${r.accessibility}${r.failedA11y.length ? ` (${r.failedA11y.join(", ")})` : ""}, LCP ${r.lcpMs} ms, TBT ${r.tbtMs} ms`);
    }
    metrics.lighthouse = lh;
  }

  // 12: console errors, paid API calls and AI spend.
  const end = await (await fetch(`${BASE}/api/status`, { headers: { cookie: COOKIE } })).json();
  metrics.paidCalls = end.paidCalls;
  metrics.spendUsd = end.spendUsd;
  if (consoleErrors.length) fail(12, "all views", `${consoleErrors.length} console errors, e.g. ${consoleErrors.slice(0, 3).join(" | ")}`);
  else pass(12, "all views", "no console errors");
  if (externalRequests.length) fail(12, "all views", `browser requests to other hosts: ${externalRequests.slice(0, 3).join(" | ")}`);
  else pass(12, "all views", "no browser requests leave localhost");
  if (end.paidCalls?.attempted) fail(12, "server", `${end.paidCalls.attempted} paid API calls attempted`);
  else pass(12, "server", "0 paid API calls (xAI, OpenAlex) attempted");
  if (end.spendUsd) fail(12, "server", `$${end.spendUsd} of AI spend recorded`);
  else pass(12, "server", "$0 AI spend: every AI step was refused before any request to xAI");

  writeReport(shots, V.length);
}

const ITEMS = [
  "The #1 action is the only accent-filled element and sits above the fold",
  "Mission clear in 3 s (squint test: the primary is the highest-contrast element)",
  "Nothing outside “Stays visible” is expanded by default",
  "No text below 4.5:1; axe reports zero serious or critical issues",
  "Visible focus ring on every interactive element; tab through the view, nothing traps focus",
  "Reduced motion: no transforms or loops",
  "No overflow, clipping or overlap at 390 px; tap targets ≥ 44 px",
  "Stale, verified and running are clear without colour (icon + text)",
  "4-pt spacing grid; at most 3 type sizes per view",
  "Canvas: 300 nodes pan at ≥ 55 fps (needs AI output: not run without a key); List view matches the graph",
  "Lighthouse (mobile): Performance ≥ 90, Accessibility 100; landing LCP < 2 s; canvas initial JS < 250 kB gzip",
  "No console errors; no network calls to paid APIs",
];

function writeReport(shots: Shot[], viewCount: number) {
  const commit = (() => {
    try {
      return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
    } catch {
      return "?";
    }
  })();
  const lines: string[] = [];
  lines.push(`# Visual audit, round ${ROUND}`, "");
  lines.push(`Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC on commit \`${commit}\`. Production build, no xAI key (API keys stripped from the server environment), fresh database, so every AI step was refused and nothing was spent. ${viewCount} views × ${QUICK ? "1 variant" : "8 variants (1440×900 and 390×844, dark and light, reduced motion on and off)"} = ${shots.length} screenshots in \`qa/shots/${ROUND}/\`.`, "");
  lines.push("| # | Checklist item | Result | Checks | Failures |", "|---|---|---|---|---|");
  ITEMS.forEach((t, i) => {
    const rs = results.filter((r) => r.item === i + 1);
    const f = rs.filter((r) => !r.ok);
    lines.push(`| ${i + 1} | ${t} | ${!rs.length ? "not run" : f.length ? "**FAIL**" : "pass"} | ${rs.length} | ${f.length} |`);
  });
  const allPass = ITEMS.every((_, i) => {
    const rs = results.filter((r) => r.item === i + 1);
    return rs.length && rs.every((r) => r.ok);
  });
  lines.push("", allPass ? "**All 12 items pass on the views reachable without an xAI key.**" : "**Not all items pass yet.**", "");
  lines.push("## Not covered without an xAI key", "", "Mock mode was removed, so views that need AI output are not seeded here; they need a real run with a key (which spends money):", "", ...NOT_COVERED.map((n) => `- ${n}`), "");
  lines.push("## Measurements", "", "```json", JSON.stringify(metrics, null, 2), "```", "");
  for (let i = 1; i <= 12; i++) {
    const f = results.filter((r) => r.item === i && !r.ok);
    if (!f.length) continue;
    lines.push(`## ${i}. ${ITEMS[i - 1]}: failures`, "");
    const grouped = new Map<string, string[]>();
    for (const r of f) grouped.set(r.msg, [...(grouped.get(r.msg) ?? []), r.where]);
    for (const [msg, where] of grouped) lines.push(`- ${msg}  \n  _${where.length} shot${where.length === 1 ? "" : "s"}: ${where.slice(0, 6).join("; ")}${where.length > 6 ? " …" : ""}_`);
    lines.push("");
  }
  fs.mkdirSync(path.join(ROOT, "qa"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, `qa/report-${ROUND}.md`), lines.join("\n"));
  fs.writeFileSync(path.join(ROOT, `qa/report-${ROUND}.json`), JSON.stringify({ round: ROUND, commit, mode: "no-key", allPass, notCovered: NOT_COVERED, metrics, results }, null, 2));
  log(allPass ? "ALL 12 ITEMS PASS" : `${results.filter((r) => !r.ok).length} failing checks`, `→ qa/report-${ROUND}.md`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      if (server?.pid) process.kill(-server.pid, "SIGTERM");
    } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
  });
