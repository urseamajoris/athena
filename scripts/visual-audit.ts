// Visual-audit QA loop for the canvas redesign.
//
//   npm run build && npx tsx scripts/visual-audit.ts --round=1 [--only=view,view] [--quick] [--skip-lighthouse]
//
// Starts its own production server in mock mode (all API keys stripped from its environment, fresh
// database), seeds fixtures covering every node state (empty, running, done, stale, error, a 300-node
// session), screenshots every view and panel at 1440×900 and 390×844, dark and light, reduced motion on
// and off, scores the 12-item checklist and writes qa/report-<round>.md (+ .json) and qa/shots/<round>/.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { chromium } = require("playwright") as Any; // the pre-installed Playwright (NODE_PATH)
const { AxeBuilder } = require("@axe-core/playwright") as Any;
const Database = require("better-sqlite3") as Any;

// ---------------------------------------------------------------- options
const arg = (k: string, d?: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? (process.argv.includes(`--${k}`) ? "true" : d);
const ROUND = arg("round", "1")!;
const ONLY = arg("only")?.split(",") ?? null;
const LH_ONLY = arg("lh")?.split(",") ?? null; // Lighthouse only these pages (iteration)
const PROFILE = arg("profile") === "true"; // log a CPU profile of the 300-node pan
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

// ---------------------------------------------------------------- server (mock mode, no keys)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athena-audit-"));
const DB = path.join(tmp, "audit.db");
let server: ChildProcess;

async function startServer() {
  if (!fs.existsSync(path.join(ROOT, ".next/BUILD_ID"))) throw new Error("No production build: run `npm run build` first.");
  const taken = await fetch(`${BASE}/api/status`).then(() => true).catch(() => false);
  if (taken) throw new Error(`Port ${PORT} is already in use; stop that server or pass --port=`);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["XAI_API_KEY", "OPENALEX_API_KEY", "NCBI_API_KEY", "CONTACT_EMAIL", "ATHENA_ENV", "MOCK_MODE", "MOCK_AI", "RECORD_FIXTURES", "SIMULATE_SOURCE_FAILURE"]) delete env[k];
  env.DATABASE_PATH = DB;
  // Run Next directly in its own process group so the whole server is stopped at the end (npx would orphan it).
  server = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: ROOT, env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stderr?.on("data", (d) => process.env.AUDIT_VERBOSE && process.stderr.write(d));
  for (let i = 0; i < 60; i++) {
    try {
      const s = await (await fetch(`${BASE}/api/status`)).json();
      if (!s.mockMode || s.production) throw new Error(`refusing to audit: server is not in mock mode (${JSON.stringify(s)})`);
      return s;
    } catch (e) {
      if (String(e).includes("refusing")) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("server did not start");
}

// ---------------------------------------------------------------- fixtures (through the real API)
const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
const ANSWERS = [
  "Patients and health workers in ASEAN countries, especially rural and underserved areas.",
  "Adoption, barriers and facilitators, acceptability, and policy readiness.",
  "Publications from 2015 onwards; any design including qualitative studies and reviews.",
  "Public and private systems, primary care and hospital teleconsultation.",
  "English-language papers.",
];
async function call<T = Any>(pid: string, p: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(`${BASE}/api/projects${pid ? `/${pid}` : ""}${p ? `/${p}` : ""}`, { method: method ?? (body ? "POST" : "GET"), headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method ?? (body ? "POST" : "GET")} ${pid}/${p} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : (null as T);
}
const create = async (idea = IDEA) => (await call<{ id: string }>("", "", { idea })).id;
async function waitStage(pid: string, n: number, wanted = ["needs_review"]) {
  for (let i = 0; i < 600; i++) {
    const v = await call(pid, "");
    const s = v.project.stageStates[String(n)];
    if (wanted.includes(s)) return;
    if (s === "failed") throw new Error(`fixture stage ${n} failed: ${v.jobs[String(n)]?.error}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`fixture stage ${n} timed out`);
}
async function scope(pid: string, full = true) {
  await call(pid, "stages/1/approve", {});
  let s = await call(pid, "scoping/start", {});
  let i = 0;
  while (!s.done && s.awaitingAnswer && (full || i < 1)) s = await call(pid, "scoping/answer", { text: ANSWERS[i++ % ANSWERS.length] });
  return s;
}
/** Run a project forward: stop when `until` is reached (stage awaiting review, or "done"). */
async function pipeline(pid: string, until: number | "done", hooks: { beforeApprove2?: () => Promise<void>; afterRanking?: () => Promise<void> } = {}) {
  await scope(pid);
  await call(pid, "scoping/topics", {});
  await hooks.beforeApprove2?.();
  await call(pid, "stages/2/approve", {});
  await call(pid, "search/build", {});
  await call(pid, "search/dryrun-all", {});
  if (until === 3) return;
  await call(pid, "stages/3/approve", {});
  for (let n = 4; n <= 9; n++) {
    await waitStage(pid, n);
    if (n === 6) await hooks.afterRanking?.();
    if (until === n) return;
    if (n === 9) {
      const q = await call(pid, "questions");
      await call(pid, `questions/${q.questions[0].id}/choose`, {});
    }
    await call(pid, `stages/${n}/approve`, {});
  }
}

interface Fixtures { [k: string]: string }
async function seed(): Promise<{ F: Fixtures; ids: Record<string, string>; pins: Record<string, string[]> }> {
  const F: Fixtures = {};
  const ids: Record<string, string> = {};
  const pins: Record<string, string[]> = {};
  F.idea = await create();
  F.scope = await create();
  await scope(F.scope, false);
  F.ghost = await create();
  await scope(F.ghost);
  await call(F.ghost, "scoping/topics", {});
  F.query = await create();
  F.full = await create();
  F.q = await create();
  F.stale = await create();
  F.running = await create();
  F.error = await create();
  F.rank = await create();
  F.big = await create();
  await Promise.all([
    pipeline(F.query, 3),
    pipeline(F.full, "done"),
    pipeline(F.q, 9).then(async () => {
      const q = await call(F.q, "questions");
      await call(F.q, `questions/${q.questions[0].id}/choose`, {});
    }),
    pipeline(F.stale, "done").then(async () => {
      const s = await call(F.stale, "scoping");
      await call(F.stale, `topics/${s.topics[0].id}`, { name: `${s.topics[0].name} (edited)` }, "PATCH");
    }),
    pipeline(F.running, 4),
    pipeline(F.error, 5),
    pipeline(F.rank, 6),
    pipeline(F.big, "done", {
      beforeApprove2: async () => {
        for (const name of ["Cost and financing", "Workforce training", "Data privacy and security"]) await call(F.big, "topics", { name });
      },
      afterRanking: async () => {
        const r = await call(F.big, "ranking");
        for (const t of r.topics) {
          const extra = t.scores.find((s: Any) => !s.selected);
          if (extra) await call(F.big, "ranking/select", { scoreId: extra.id, selected: true });
        }
      },
    }),
  ]);
  // Freeze a running retrieval and a failed summary step (direct DB edits; the job runner never sees them).
  const db = new Database(DB);
  const setState = (pid: string, n: number, s: string) => {
    const row = db.prepare("select stage_states from projects where id = ?").get(pid);
    const st = JSON.parse(row.stage_states);
    st[String(n)] = s;
    db.prepare("update projects set stage_states = ? where id = ?").run(JSON.stringify(st), pid);
  };
  setState(F.running, 4, "running");
  db.prepare("update jobs set status = 'running', ended_at = null, progress = ? where project_id = ? and stage = 4").run(JSON.stringify({ done: 6, total: 10, message: "Searching OpenAlex: Policy, regulation and governance" }), F.running);
  const runs = db.prepare('select id from search_runs where project_id = ? order by "order" desc limit 4').all(F.running);
  for (const r of runs) db.prepare("update search_runs set status = 'running', fetched_count = fetched_count / 2, new_unique_count = new_unique_count / 2 where id = ?").run(r.id);
  setState(F.error, 5, "failed");
  db.prepare("update jobs set status = 'failed', error = ?, ended_at = ? where project_id = ? and stage = 5").run("The AI response did not pass validation after one retry: 8 rows were returned for a batch of 10 papers.", new Date().toISOString(), F.error);
  db.close();

  const firstTopic = async (pid: string) => (await call(pid, "scoping")).topics[0].id;
  ids.ghostTopic = await firstTopic(F.ghost);
  ids.queryTopic = await firstTopic(F.query);
  const claims = await call(F.full, "claims");
  ids.quote = claims.find((c: Any) => c.verified)?.id ?? claims[0].id;
  pins[F.full] = [ids.quote];
  // 300-node session: pin enough quotes to reach 300 nodes in total.
  const big = await call(F.big, "canvas");
  const mainNodes = 1 + big.topics.length * 2 + 7;
  const bigClaims = await call(F.big, "claims");
  pins[F.big] = bigClaims.slice(0, Math.max(0, 300 - mainNodes)).map((c: Any) => c.id);
  ids.bigNodes = String(mainNodes + pins[F.big].length);
  return { F, ids, pins };
}

// ---------------------------------------------------------------- views
interface View { name: string; path: string; ready: string; noPrimary?: boolean; pins?: string; list?: string; canvasOnly?: boolean }
function views(F: Fixtures, ids: Record<string, string>): View[] {
  const s = (k: string, q = "") => `/s/${F[k]}${q}`;
  return [
    { name: "landing", path: "/", ready: "h1" },
    { name: "sessions", path: "/sessions", ready: "h1" },
    { name: "settings", path: "/settings", ready: "#mock-title", noPrimary: true },
    { name: "canvas-empty", path: "/s/new", ready: "#idea" },
    { name: "canvas-idea", path: s("idea"), ready: "[data-node-id],[data-list-node]" },
    { name: "panel-idea-scoping", path: s("scope", "?node=idea"), ready: "[data-panel]" },
    { name: "canvas-ghosts", path: s("ghost"), ready: "[data-node-id],[data-list-node]" },
    { name: "panel-topic-ghost", path: s("ghost", `?node=topic:${ids.ghostTopic}`), ready: "[data-panel]" },
    { name: "panel-query", path: s("query", `?node=query:${ids.queryTopic}`), ready: "[data-panel]" },
    { name: "canvas-running", path: s("running"), ready: "[data-node-id],[data-list-node]", noPrimary: true },
    { name: "panel-corpus-running", path: s("running", "?node=corpus"), ready: "[data-panel]", noPrimary: true },
    { name: "canvas-error", path: s("error"), ready: "[data-node-id],[data-list-node]" },
    { name: "panel-table-error", path: s("error", "?node=table"), ready: "[data-panel]" },
    { name: "canvas-done", path: s("full"), ready: "[data-node-id],[data-list-node]", pins: F.full },
    { name: "panel-appraisal", path: s("full", "?node=appraisal"), ready: "[data-panel]", pins: F.full },
    { name: "panel-synthesis", path: s("full", "?node=synthesis"), ready: "[data-panel]", noPrimary: true },
    { name: "panel-questions", path: s("q", "?node=questions"), ready: "[data-panel]" },
    { name: "panel-export", path: s("full", "?node=export"), ready: "[data-panel] pre" },
    { name: "panel-quote", path: s("full", `?node=quote:${ids.quote}`), ready: "[data-panel]", pins: F.full, noPrimary: true },
    { name: "canvas-stale", path: s("stale"), ready: "[data-node-id],[data-list-node]" },
    { name: "canvas-300", path: s("big"), ready: "[data-node-id],[data-list-node]", pins: F.big },
    { name: "list-view", path: s("full"), ready: "[data-list-node]", list: F.full, pins: F.full },
    { name: "table", path: s("rank", "/table"), ready: "table tbody tr" },
    { name: "export-page", path: s("full", "/export"), ready: "main pre" },
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

async function measureFps(page: Any, where: string) {
  // The pan is driven from inside the page, one pointer move per animation frame, so the viewport changes on
  // every frame (Playwright's mouse moves arrive about every 30 ms and would cap the drawn frame rate at ~30).
  // The trace counts the frames the compositor actually drew; rAF shows whether the main thread kept up.
  const cdp = await page.context().newCDPSession(page);
  if (PROFILE) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
  }
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline.frame", transferMode: "ReturnAsStream" });
  const raf = await page.evaluate(
    () =>
      new Promise<{ fps: number; frames: number; p95: number; moved: number }>((resolve) => {
        const pane = document.querySelector(".react-flow__pane") as HTMLElement;
        const vpEl = document.querySelector(".react-flow__viewport") as HTMLElement;
        const r = pane.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const ev = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === "mouseup" ? 0 : 1 });
        const before = vpEl.style.transform;
        pane.dispatchEvent(ev("mousedown", cx, cy));
        const gaps: number[] = [];
        let n = 0;
        let moved = 0;
        let last = performance.now();
        const start = last;
        const tick = (t: number) => {
          n++;
          gaps.push(t - last);
          last = t;
          const a = ((t - start) / 1000) * Math.PI;
          window.dispatchEvent(ev("mousemove", cx + Math.sin(a) * 300, cy + Math.cos(a) * 150 - 150));
          if (vpEl.style.transform !== before) moved++;
          if (t - start < 2000) requestAnimationFrame(tick);
          else {
            window.dispatchEvent(ev("mouseup", cx, cy));
            gaps.sort((x, y) => x - y);
            resolve({ fps: (n * 1000) / (t - start), frames: n, p95: gaps[Math.floor(gaps.length * 0.95)], moved });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  if (PROFILE) {
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map<string, number>();
    const dt = profile.timeDeltas as number[];
    const byId = new Map<number, Any>(profile.nodes.map((n: Any) => [n.id, n]));
    (profile.samples as number[]).forEach((id, i) => {
      const f = byId.get(id).callFrame;
      const k = `${f.functionName || "(anon)"} ${path.basename(f.url)}:${f.lineNumber}:${f.columnNumber}`;
      self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    log("profile (self ms):\n" + [...self].sort((x, y) => y[1] - x[1]).slice(0, 30).map(([k, v]) => `${v.toFixed(0).padStart(6)} ${k}`).join("\n"));
  }
  let traceFps: number | null = null;
  try {
    const done = new Promise<Any>((r) => cdp.once("Tracing.tracingComplete", r));
    await cdp.send("Tracing.end");
    const { stream } = await done;
    let data = "";
    for (;;) {
      const chunk = await cdp.send("IO.read", { handle: stream });
      data += chunk.data;
      if (chunk.eof) break;
    }
    const parsed = JSON.parse(data);
    const events: Any[] = parsed.traceEvents ?? parsed;
    if (PROFILE) {
      const sum = new Map<string, { ms: number; n: number }>();
      for (const e of events) {
        if (e.ph !== "X" || !e.dur) continue;
        const k = `${e.name} [${e.tid}]`;
        const v = sum.get(k) ?? { ms: 0, n: 0 };
        v.ms += e.dur / 1000;
        v.n++;
        sum.set(k, v);
      }
      log("trace (ms, count):\n" + [...sum].sort((x, y) => y[1].ms - x[1].ms).slice(0, 25).map(([k, v]) => `${v.ms.toFixed(0).padStart(6)} ${String(v.n).padStart(5)} ${k}`).join("\n"));
    }
    const draws = events.filter((e) => e.name === "DrawFrame").map((e) => e.ts).sort((a: number, b: number) => a - b);
    if (draws.length > 10) traceFps = ((draws.length - 1) * 1e6) / (draws[draws.length - 1] - draws[0]);
  } catch {}
  const r1 = (x: number) => Math.round(x * 10) / 10;
  metrics.canvasPanFps = { raf: r1(raf.fps), rafP95FrameMs: r1(raf.p95), trace: traceFps ? r1(traceFps) : null, framesWithPan: raf.moved };
  if (raf.moved < raf.frames / 2) return fail(10, where, `the pan did not move the viewport (${raf.moved}/${raf.frames} frames)`);
  const fps = traceFps ?? raf.fps;
  const msg = `pans at ${fps.toFixed(1)} fps drawn (rAF ${raf.fps.toFixed(1)}, p95 frame ${raf.p95.toFixed(1)} ms)`;
  if (fps >= 55 && raf.fps >= 55) pass(10, where, msg);
  else fail(10, where, `${msg}, below 55`);
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
    execFileSync(path.join(ROOT, "node_modules/.bin/lighthouse"), [url, "--quiet", "--output=json", `--output-path=${out}`, "--only-categories=performance,accessibility", "--chrome-flags=--headless=new --no-sandbox --disable-gpu"], { env: { ...process.env, CHROME_PATH: CHROME }, stdio: "ignore", timeout: 180000 });
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
async function newContext(browser: Any, opts: Any) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(NAME_SHIM);
  return ctx;
}

async function main() {
  const status = await startServer();
  log("server ready in mock mode; keys present to the server:", JSON.stringify(status.keys));
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
      const page = await ctx.newPage();
      await page.addInitScript((s: string) => localStorage.setItem("athena-canvas", s), clientState(pins, v));
      page.on("console", (m: Any) => m.type() === "error" && consoleErrors.push(`${tag}: ${m.text().slice(0, 160)}`));
      page.on("pageerror", (e: Any) => consoleErrors.push(`${tag}: ${String(e).slice(0, 160)}`));
      page.on("request", (r: Any) => {
        const u = new URL(r.url());
        if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("data") && !u.protocol.startsWith("blob")) externalRequests.push(`${tag}: ${r.url()}`);
      });
      try {
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
        await page.close();
      }
    }
    await ctx.close();
    log(`variant ${vr.size}/${vr.theme}/${vr.motion} done`);
  }

  // 10: canvas performance with the 300-node session, and List view = graph.
  if (!ONLY || ONLY.includes("canvas-300")) {
    const pinsBig = clientState(pins, { name: "", path: "", ready: "" });
    const n = await listMatchesGraph(browser, `/s/${F.big}`, pinsBig, "canvas-300");
    await listMatchesGraph(browser, `/s/${F.full}`, pinsBig, "canvas-done");
    metrics.bigSessionNodes = n;
    const ctx = await newContext(browser, { viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((s: string) => localStorage.setItem("athena-canvas", s), pinsBig);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/s/${F.big}`);
    await page.locator("[data-node-id]").first().waitFor({ timeout: 60000 });
    // Pan once the layout has settled (the elkjs refinement lands shortly after load).
    await page.waitForFunction(
      () =>
        new Promise<boolean>((resolve) => {
          const sig = () => [...document.querySelectorAll(".react-flow__node")].map((n) => (n as HTMLElement).style.transform).join("|") + (document.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
          const a = sig();
          setTimeout(() => resolve(sig() === a), 1000);
        }),
      null,
      { timeout: 20000, polling: 100 },
    ).catch(() => log("canvas-300: layout still moving after 20 s"));
    if (arg("fps-css")) await page.addStyleTag({ content: arg("fps-css") });
    await measureFps(page, `canvas-300 (${n} nodes)`);
    await ctx.close();
    const b = (await bundleSize(browser, `/s/${F.full}`)) as Any;
    if (b.initialGzipKb < 250) pass(11, "canvas route JS", `${b.initialGzipKb} kB gzip before the first node shows`);
    else fail(11, "canvas route JS", `${b.initialGzipKb} kB gzip before the first node shows (budget 250)`);
  }
  await browser.close();

  // 11: Lighthouse (mobile emulation, the default).
  if (!SKIP_LH) {
    const pages: Record<string, string> = { landing: "/", sessions: "/sessions", settings: "/settings", "canvas-empty": "/s/new", "canvas-done": `/s/${F.full}`, table: `/s/${F.full}/table`, "export-page": `/s/${F.full}/export` };
    const lh: Record<string, unknown> = {};
    for (const [name, p] of Object.entries(pages)) {
      if (LH_ONLY && !LH_ONLY.includes(name)) continue;
      // Three runs, median performance (Lighthouse's advice for variable machines); accessibility must be 100
      // in every run.
      await fetch(BASE + p).catch(() => {}); // warm the server's route first (a running server is warm)
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

  // 12: console errors and paid API calls.
  const end = await (await fetch(`${BASE}/api/status`)).json();
  metrics.paidCalls = end.paidCalls;
  if (consoleErrors.length) fail(12, "all views", `${consoleErrors.length} console errors, e.g. ${consoleErrors.slice(0, 3).join(" | ")}`);
  else pass(12, "all views", "no console errors");
  if (externalRequests.length) fail(12, "all views", `browser requests to other hosts: ${externalRequests.slice(0, 3).join(" | ")}`);
  else pass(12, "all views", "no browser requests leave localhost");
  if (end.paidCalls.attempted) fail(12, "server", `${end.paidCalls.attempted} paid API calls attempted`);
  else pass(12, "server", "0 paid API calls (xAI, OpenAlex) attempted");

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
  "Canvas: 300 nodes pan at ≥ 55 fps; List view matches the graph",
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
  lines.push(`Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC on commit \`${commit}\`. Production build, mock mode, API keys stripped from the server environment, fresh database. ${viewCount} views × ${QUICK ? "1 variant" : "8 variants (1440×900 and 390×844, dark and light, reduced motion on and off)"} = ${shots.length} screenshots in \`qa/shots/${ROUND}/\`.`, "");
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
  lines.push("", allPass ? "**All 12 items pass in this round.**" : "**Not all items pass yet.**", "");
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
  fs.writeFileSync(path.join(ROOT, `qa/report-${ROUND}.json`), JSON.stringify({ round: ROUND, commit, allPass, metrics, results }, null, 2));
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
