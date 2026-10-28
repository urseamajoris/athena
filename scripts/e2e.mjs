// End-to-end UI test: drives all nine stages through the browser like a student would.
// Usage: node scripts/e2e.mjs [baseUrl] [--out=dir]
// Works in MOCK_MODE (free) and real mode (costs xAI credit). Screenshots are written per stage.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // pre-installed Playwright (CommonJS resolution honours NODE_PATH)

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const out = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "e2e-artifacts/run";
fs.mkdirSync(out, { recursive: true });
const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
const ANSWERS = [
  "Mainly patients and health workers in ASEAN countries, especially rural and underserved areas; health-system decision makers too.",
  "Implementation outcomes: adoption/uptake, barriers and facilitators, acceptability, and policy or infrastructure readiness.",
  "Publications from 2015 onwards; any study design including qualitative studies, surveys and systematic or scoping reviews.",
  "Both public and private health systems, primary care and hospital teleconsultation.",
  "English-language papers are fine.",
];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  log(ok ? "✓" : "✗", name, detail);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
let pid;
const api = async (path) => (await fetch(`${base}/api/projects/${pid}${path}`)).json();
const states = async () => (await api("")).project.stageStates;

async function waitState(n, wanted = ["needs_review"], timeoutMs = 30 * 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = (await states())[String(n)];
    if (wanted.includes(s)) return s;
    if (s === "failed") throw new Error(`stage ${n} failed: ${(await api("")).jobs[String(n)]?.error}`);
    if (Date.now() > end) throw new Error(`timeout waiting for stage ${n} (state ${s})`);
    await page.waitForTimeout(2500);
  }
}
async function approve(n) {
  await page.getByRole("button", { name: n === 9 ? "Finish and see summary" : "Approve and continue" }).click();
  if (n < 9) await page.waitForURL(new RegExp(`stage=${n + 1}`), { timeout: 60_000 });
  await page.waitForTimeout(800);
  const s = (await states())[String(n)];
  if (s !== "approved") throw new Error(`stage ${n} not approved (state ${s})`);
}

try {
  // 1. Idea
  await page.goto(base);
  await page.getByLabel("Your research idea").fill(IDEA);
  await page.getByRole("button", { name: "Start review" }).click();
  await page.waitForURL(/projects\/prj_/);
  pid = page.url().match(/projects\/(prj_[a-z0-9]+)/)[1];
  log("project", pid);
  await page.getByRole("navigation", { name: "Review stages" }).waitFor();
  await page.waitForTimeout(1500); // let React hydrate before the first click
  await shot("1-idea");
  for (let i = 0; i < 3 && !/stage=2/.test(page.url()); i++) {
    await page.getByRole("button", { name: /Save and start scoping/ }).click().catch(() => {});
    await page.waitForURL(/stage=2/, { timeout: 20_000 }).catch(() => {});
  }

  // 2. Scoping chat
  for (let i = 0; i < 6; i++) {
    const box = page.getByLabel("Your answer");
    const buildBtn = page.getByRole("button", { name: /Build my search topics/ });
    await Promise.race([box.and(page.locator(":enabled")).waitFor({ timeout: 120_000 }), buildBtn.waitFor({ timeout: 120_000 })]);
    if (await buildBtn.isVisible()) break;
    const q = await page.locator('[aria-label="Scoping conversation"] .bg-gray-100').last().innerText();
    log(`Q${i + 1}:`, q.replace(/\s+/g, " ").slice(0, 140));
    await box.fill(ANSWERS[i]);
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForTimeout(500);
  }
  const sc = await api("/scoping");
  check("scoping asked at most 5 questions", sc.asked <= 5, `asked ${sc.asked}`);
  await page.getByRole("button", { name: /Build my search topics/ }).click();
  await page.getByText("Search topics", { exact: true }).waitFor({ timeout: 180_000 });
  await page.waitForTimeout(500);
  const topics = (await api("/scoping")).topics;
  check("4–8 topics generated", topics.length >= 4 && topics.length <= 8, topics.map((t) => t.name).join(" | "));
  check("every topic has synonyms and a rationale", topics.every((t) => t.synonyms.length && t.rationale));
  await shot("2-scoping");
  // A user edit: add a topic, then delete it (exercise the checkpoint controls).
  await page.getByLabel("New topic name").fill("Cost and financing of telemedicine");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Delete topic Cost and financing of telemedicine" }).waitFor();
  check("user can add a topic", (await api("/scoping")).topics.length === topics.length + 1);
  await page.getByRole("button", { name: "Delete topic Cost and financing of telemedicine" }).click();
  await page.waitForTimeout(800);
  check("user can delete a topic", (await api("/scoping")).topics.length === topics.length);
  await approve(2);

  // 3. Search builder (auto-builds queries)
  await page.getByRole("button", { name: "Dry-run all" }).waitFor({ timeout: 180_000 });
  await page.getByRole("button", { name: "Dry-run all" }).click();
  await page.getByText(/records$/).first().waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1500);
  const search = await api("/search");
  const qs = search.topics.flatMap((t) => t.queries);
  check("one query per database per topic", search.topics.every((t) => t.queries.length === 2), `${qs.length} queries`);
  check("dry-run counts shown", qs.every((q) => q.dryRunAt), qs.map((q) => q.dryRunCount ?? `ERR ${q.dryRunError}`).join(", "));
  await shot("3-search");
  await approve(3);

  // 4. Retrieval (background job + SSE)
  log("retrieval running…");
  await page.waitForTimeout(3000);
  await page.reload(); // leaving/returning must not lose progress
  await waitState(4);
  await page.waitForTimeout(1500);
  const ret = await api("/retrieval");
  check("retrieval finished all queries", ret.runs.every((r) => r.status !== "running" && r.status !== "queued"), ret.runs.map((r) => `${r.database}:${r.status}`).join(" "));
  check("papers deduplicated", ret.uniquePapers > 0 && ret.uniquePapers <= ret.runs.reduce((a, r) => a + r.fetchedCount, 0), `${ret.uniquePapers} unique of ${ret.runs.reduce((a, r) => a + r.fetchedCount, 0)} fetched`);
  await shot("4-retrieval");
  await approve(4);

  // 5. Summary table
  log("summaries running…");
  await waitState(5);
  await page.reload();
  await page.getByRole("table").waitFor();
  const papers = (await api("/papers")).papers;
  check("every paper has a real identifier", papers.every((p) => p.doi || p.pmid || p.openalexId), `${papers.length} papers`);
  check("summary rows filled", papers.filter((p) => p.summary).length >= papers.length * 0.9, `${papers.filter((p) => p.summary).length}/${papers.length}`);
  await page.getByRole("button", { name: /^Cites/ }).click(); // sort by citations
  await page.getByRole("textbox", { name: "Search papers" }).fill("Indonesia");
  await page.waitForTimeout(400);
  await shot("5-summary");
  await page.getByRole("textbox", { name: "Search papers" }).fill("");
  // open the drawer for the first paper
  await page.locator("tbody button").first().click();
  await page.getByRole("dialog", { name: "Paper details" }).getByText("Found by these queries").waitFor();
  await shot("5-drawer");
  await page.keyboard.press("Escape");
  await approve(5);

  // 6. Ranking
  log("ranking running…");
  await waitState(6);
  await page.reload();
  await page.waitForTimeout(1000);
  const rank = await api("/ranking");
  check("3–5 papers selected per topic", rank.topics.every((t) => { const n = t.scores.filter((s) => s.selected).length; return n >= 3 && n <= 5; }), rank.topics.map((t) => t.scores.filter((s) => s.selected).length).join(","));
  check("topics ordered by importance with justification", rank.topics.every((t) => t.importanceRank && t.importanceJustification));
  // swap one selection
  const swapSel = page.locator('section[aria-label^="Topic "] select').first();
  const opt = await swapSel.locator("option").nth(1).getAttribute("value");
  await swapSel.selectOption(opt);
  await page.waitForTimeout(1200);
  const rank2 = await api("/ranking");
  check("user can swap a selected paper", rank2.topics.some((t) => t.scores.some((s) => s.userChanged)));
  await shot("6-ranking");
  await approve(6);

  // 7. Appraisal
  log("appraisal running…");
  await waitState(7);
  await page.reload();
  await page.waitForTimeout(1500);
  const apps = (await api("/appraisals")).appraisals;
  check("every appraisal labelled full text or abstract only", apps.every((a) => ["full_text", "abstract"].includes(a.textSource)), `${apps.filter((a) => a.textSource === "full_text").length} full text, ${apps.filter((a) => a.textSource === "abstract").length} abstract only`);
  const details = await Promise.all(apps.filter((a) => a.status === "done").map((a) => api(`/appraisals/${a.id}`)));
  const allClaims = details.flatMap((d) => d.claims);
  const extracted = allClaims.filter((c) => !c.notReported);
  check("every extracted claim has a quote", extracted.every((c) => c.quote.trim().length > 0), `${extracted.length} claims`);
  let mismatch = 0;
  for (const d of details) for (const c of d.claims) {
    if (c.verified) {
      const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-—−]/g, "-").replace(/\s+/g, " ").trim();
      const span = d.sourceText.text.slice(c.matchStart, c.matchEnd);
      if (!norm(span).length) mismatch++;
    }
  }
  check("verified quotes point at real spans of the source text", mismatch === 0, `${extracted.filter((c) => c.verified).length} verified, ${extracted.filter((c) => !c.verified).length} unverified`);
  await shot("7-appraisal");
  const accept = page.getByRole("button", { name: "Accept anyway" }).first();
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
    await page.waitForTimeout(1000);
    check("user can accept an unverified quote", (await Promise.all(apps.map((a) => api(`/appraisals/${a.id}`)))).some((d) => d.claims.some((c) => c.userAccepted)));
  }
  await approve(7);

  // 8. Synthesis
  log("synthesis running…");
  await waitState(8);
  await page.reload();
  await page.waitForTimeout(1500);
  const syn = await api("/synthesis");
  const items = syn.topics.flatMap((t) => t.items);
  check("synthesis statements all cite claims", items.length > 0 && items.every((i) => i.claimIds.length > 0), `${items.length} statements, ${syn.topics.reduce((a, t) => a + t.contradictions.length, 0)} contradictions`);
  const cited = items.flatMap((i) => i.claimIds).map((id) => syn.claims[id]);
  check("synthesis only cites verified or user-accepted claims", cited.every((c) => c && (c.verified || c.userAccepted)));
  await shot("8-synthesis");
  await approve(8);

  // 9. Research questions
  log("questions running…");
  await waitState(9);
  await page.reload();
  await page.waitForTimeout(1500);
  const rq = await api("/questions");
  check("three candidate questions", rq.questions.length === 3, rq.questions.map((q) => q.text).join(" || "));
  check("each question links to supporting claims", rq.questions.every((q) => q.claimIds.length > 0));
  check("novelty searches ran", rq.questions.every((q) => q.noveltyStatus !== "pending"), rq.questions.map((q) => `${q.noveltyMatches.length} matches`).join(", "));
  await shot("9-questions");
  await page.getByRole("button", { name: "Choose this question" }).first().click();
  await page.getByText("Refine your chosen question").waitFor();
  const qbox = page.getByLabel("Question", { exact: true });
  await qbox.fill((await qbox.inputValue()).replace(/\?$/, "") + " between 2015 and 2025?");
  await page.getByRole("button", { name: "Save edits" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Finish and see summary" }).click();
  await page.getByText("Your research question").waitFor({ timeout: 30_000 });
  await shot("9-final");
  check("question chosen and edited", (await api("/questions")).questions.some((q) => q.chosen && q.edited));

  // Exports
  for (const [label, ext] of [["Download report (Markdown)", "md"], ["Summary table (CSV)", "csv"], ["Selected papers (BibTeX)", "bib"]]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("main").getByRole("link", { name: label }).click()]);
    const path = `${out}/export.${ext}`;
    await dl.saveAs(path);
    check(`export ${ext}`, fs.statSync(path).size > 200, `${fs.statSync(path).size} bytes`);
  }

  // Stale tracking: edit the topic list after retrieval → later stages become stale.
  await page.goto(`${base}/projects/${pid}?stage=2`);
  const firstName = page.getByLabel("Topic name").first();
  await firstName.waitFor();
  await firstName.fill((await firstName.inputValue()) + " (edited)");
  await page.getByLabel("New topic name").click(); // blur → save → confirmation dialog
  await page.getByRole("button", { name: "Edit and mark later steps stale" }).click();
  await page.waitForTimeout(1500);
  const st = await states();
  check("editing topics marks stages 3–9 stale", [3, 4, 5, 6, 7, 8, 9].every((n) => st[String(n)] === "stale"), JSON.stringify(st));
  await page.goto(`${base}/projects/${pid}?stage=5`);
  await page.getByText("These results may be out of date.").waitFor();
  await shot("stale-banner");
} catch (e) {
  check("run completed without error", false, String(e.message ?? e));
  await shot("error").catch(() => {});
} finally {
  check("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
  const status = await (await fetch(`${base}/api/status`)).json();
  const view = pid ? await api("") : null;
  const total = view ? Object.values(view.costs).reduce((a, c) => a + c.cost, 0) : 0;
  log(`AI cost this project: $${total.toFixed(4)} · total recorded spend $${status.spendUsd.toFixed(4)}`);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ project: pid, mode: status.mockMode ? "mock" : status.mockAi ? "mock-ai" : "real", costs: view?.costs, checks }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  log(failed.length ? `${failed.length} CHECK(S) FAILED` : `ALL ${checks.length} CHECKS PASSED`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
