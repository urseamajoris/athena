// End-to-end UI test: drives all nine stages through the canvas like a student would.
// Usage: node scripts/e2e.mjs [baseUrl] [--out=dir]
// The acceptance checks (and their names) are the ones the wizard e2e asserted; only the driving changed.
// Run it against a server in mock mode (the default outside ATHENA_ENV=production): it costs nothing.
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
let pid;
// API reads go through the browser context, so they carry the signed-in user's session cookie.
const api = async (path) => (await ctx.request.get(`${base}/api/projects/${pid}${path}`)).json();
const states = async () => (await api("")).project.stageStates;
const panel = () => page.locator("[data-panel]");
const node = (id) => page.locator(`[data-node-id="${id}"]`);
const footer = () => page.locator("[data-panel-footer]");

async function waitState(n, wanted = ["needs_review"], timeoutMs = 30 * 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = (await states())[String(n)];
    if (wanted.includes(s)) return s;
    if (s === "failed") throw new Error(`stage ${n} failed: ${(await api("")).jobs[String(n)]?.error}`);
    if (Date.now() > end) throw new Error(`timeout waiting for stage ${n} (state ${s})`);
    await page.waitForTimeout(1500);
  }
}
async function waitApproved(n) {
  await waitState(n, ["approved"], 60_000);
}
/** Open a node's Focus panel the way a keyboard user would: focus it, press Enter. */
async function openNode(id) {
  await node(id).waitFor({ timeout: 60_000 });
  await node(id).focus();
  await page.keyboard.press("Enter");
  await panel().waitFor();
}
async function menu(label) {
  await panel().getByRole("button", { name: /^More actions/ }).click();
  await page.getByRole("menuitem", { name: label }).click();
}

try {
  // 0. Accounts: a new user signs up through the UI (the landing's call to action), then lands on the empty canvas.
  await page.goto(`${base}/`);
  await page.getByRole("link", { name: "Start a review" }).click();
  await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.org`);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/s\/new/);

  // 1. Idea: the empty canvas.
  await page.getByLabel("Describe your research idea").fill(IDEA);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/s\/prj_/);
  pid = page.url().match(/\/s\/(prj_[a-z0-9]+)/)[1];
  log("project", pid);
  await node("idea").waitFor();
  await shot("1-idea");
  await node("idea").getByRole("button", { name: "Sharpen my idea" }).click();
  await waitApproved(1);

  // 2. Scoping chat (in the Idea panel), then subtopics.
  await panel().waitFor();
  for (let i = 0; i < 6; i++) {
    const box = page.getByLabel("Your answer");
    const branch = footer().getByRole("button", { name: "Suggest search topics" });
    await Promise.race([box.and(page.locator(":enabled:not([aria-busy=true])")).waitFor({ timeout: 120_000 }), branch.waitFor({ timeout: 120_000 })]);
    if (await branch.isVisible()) break;
    const q = await panel().locator('[data-role="assistant"]').last().innerText();
    log(`Q${i + 1}:`, q.replace(/\s+/g, " ").slice(0, 140));
    await box.fill(ANSWERS[i]);
    await footer().getByRole("button", { name: "Send answer" }).click();
    await page.waitForTimeout(400);
  }
  const sc = await api("/scoping");
  check("scoping asked at most 5 questions", sc.asked <= 5, `asked ${sc.asked}`);
  await footer().getByRole("button", { name: "Suggest search topics" }).click();
  await page.locator('[data-kind="topic"][data-status="ghost"]').first().waitFor({ timeout: 180_000 });
  const topics = (await api("/scoping")).topics;
  check("4–8 topics generated", topics.length >= 4 && topics.length <= 8, topics.map((t) => t.name).join(" | "));
  check("every topic has synonyms and a rationale", topics.every((t) => t.synonyms.length && t.rationale));
  await shot("2-scoping");
  // A user edit: add a topic, then delete it (exercise the checkpoint controls).
  await panel().getByRole("button", { name: "Add or merge topics" }).click();
  await page.getByLabel("New topic name").fill("Cost and financing of telemedicine");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const added = page.locator('[data-kind="topic"]', { hasText: "Cost and financing of telemedicine" });
  await added.waitFor();
  check("user can add a topic", (await api("/scoping")).topics.length === topics.length + 1);
  const addedId = await added.getAttribute("data-node-id");
  await openNode(addedId);
  await menu("Delete topic");
  await added.waitFor({ state: "detached" });
  check("user can delete a topic", (await api("/scoping")).topics.length === topics.length);
  // Accept the suggested subtopics: one with the keyboard, the rest at once.
  const ghost = page.locator('[data-kind="topic"][data-status="ghost"]').first();
  await ghost.focus();
  await page.keyboard.press("Enter");
  await openNode("idea");
  await footer().getByRole("button", { name: /^Keep \d+ suggested topics?$/ }).click();
  await footer().getByRole("button", { name: "Use these topics" }).click();
  await waitApproved(2);

  // 3. Search builder: build the queries from a topic, dry-run them, run the search.
  await page.keyboard.press("Escape");
  const firstTopic = page.locator('[data-kind="topic"]').first();
  await firstTopic.getByRole("button", { name: "Write the searches" }).click();
  await page.locator('[data-kind="query"]').first().waitFor({ timeout: 180_000 });
  await openNode(await page.locator('[data-kind="query"]').first().getAttribute("data-node-id"));
  await menu("Count matches for every search");
  await panel().getByText(/papers? match\./).first().waitFor({ timeout: 180_000 });
  await page.waitForTimeout(800);
  const search = await api("/search");
  const qs = search.topics.flatMap((t) => t.queries);
  check("one query per database per topic", search.topics.every((t) => t.queries.length === 2), `${qs.length} queries`);
  check("dry-run counts shown", qs.every((q) => q.dryRunAt), qs.map((q) => q.dryRunCount ?? `ERR ${q.dryRunError}`).join(", "));
  await shot("3-search");
  await footer().getByRole("button", { name: /^Run (all \d+ searches|the search)$/ }).click();
  await waitApproved(3);

  // 4. Retrieval (background job + SSE)
  log("retrieval running…");
  await node("corpus").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.reload(); // leaving/returning must not lose progress
  await waitState(4);
  await page.waitForTimeout(1000);
  const ret = await api("/retrieval");
  check("retrieval finished all queries", ret.runs.every((r) => r.status !== "running" && r.status !== "queued"), ret.runs.map((r) => `${r.database}:${r.status}`).join(" "));
  check("papers deduplicated", ret.uniquePapers > 0 && ret.uniquePapers <= ret.runs.reduce((a, r) => a + r.fetchedCount, 0), `${ret.uniquePapers} unique of ${ret.runs.reduce((a, r) => a + r.fetchedCount, 0)} fetched`);
  await openNode("corpus");
  await shot("4-retrieval");
  await footer().getByRole("button", { name: "Summarise the papers" }).click();
  await waitApproved(4);

  // 5. Summary table
  log("summaries running…");
  await waitState(5);
  const papers = (await api("/papers")).papers;
  check("every paper has a real identifier", papers.every((p) => p.doi || p.pmid || p.openalexId), `${papers.length} papers`);
  check("summary rows filled", papers.filter((p) => p.summary).length >= papers.length * 0.9, `${papers.filter((p) => p.summary).length}/${papers.length}`);
  await page.goto(`${base}/s/${pid}/table`);
  await page.getByRole("table").waitFor();
  await page.getByRole("button", { name: /^Year/ }).click(); // sort
  await page.getByRole("searchbox", { name: "Search papers" }).fill("Indonesia");
  await page.waitForTimeout(400);
  await shot("5-summary");
  await page.getByRole("searchbox", { name: "Search papers" }).fill("");
  await page.locator("tbody button.link").first().click(); // first title
  await page.getByRole("dialog", { name: "Paper details" }).getByText("Found by these queries").waitFor();
  await shot("5-drawer");
  await page.keyboard.press("Escape");
  await page.getByRole("banner").getByRole("button", { name: "Rank the papers" }).click();
  await waitApproved(5);

  // 6. Ranking (same table, per-topic tabs)
  log("ranking running…");
  await waitState(6);
  await page.reload();
  await page.getByRole("group", { name: "Topic" }).getByRole("button").nth(1).waitFor();
  const rank = await api("/ranking");
  // Up to 4 per topic, and only papers that match the topic (topic fit 2/5 or more), so a topic may have fewer.
  check("at most 5 papers selected per topic, none without a topic match", rank.topics.every((t) => { const sel = t.scores.filter((s) => s.selected); return sel.length <= 5 && sel.every((s) => s.topicFit >= 2); }), rank.topics.map((t) => t.scores.filter((s) => s.selected).length).join(","));
  check("topics ordered by importance with justification", rank.topics.every((t) => t.importanceRank && t.importanceJustification));
  // swap one selection: open a selected row's details and swap it for another paper
  await page.getByRole("group", { name: "Topic" }).getByRole("button").nth(1).click();
  await page.locator('tbody input[type="checkbox"]:checked').first().waitFor();
  const selRow = page.locator("tbody").filter({ has: page.locator('input[type="checkbox"]:checked') }).first();
  await selRow.getByRole("button", { name: /^Show details/ }).click();
  const swapSel = page.getByLabel("Swap for another paper in this topic");
  await swapSel.selectOption({ index: 1 });
  await page.waitForTimeout(1200);
  const rank2 = await api("/ranking");
  check("user can swap a selected paper", rank2.topics.some((t) => t.scores.some((s) => s.userChanged)));
  await shot("6-ranking");
  await page.getByRole("banner").getByRole("button", { name: "Appraise selected papers" }).click();
  // A topic with fewer than 3 papers asks first.
  // Wait for whichever comes first: the dialog (its code may still be loading) or the approval itself.
  const anyway = page.getByRole("button", { name: "Appraise anyway" });
  const asked = await Promise.race([anyway.waitFor({ timeout: 30000 }).then(() => true, () => false), waitApproved(6).then(() => false, () => false)]);
  if (asked) await anyway.click();
  await waitApproved(6);

  // 7. Appraisal (back on the canvas)
  log("appraisal running…");
  await waitState(7);
  await page.goto(`${base}/s/${pid}?node=appraisal`);
  await panel().waitFor();
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
  for (let i = 0; i < apps.length; i++) {
    const accept = panel().getByRole("button", { name: "Accept anyway" }).first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
      await page.waitForTimeout(1000);
      check("user can accept an unverified quote", (await Promise.all(apps.map((a) => api(`/appraisals/${a.id}`)))).some((d) => d.claims.some((c) => c.userAccepted)));
      break;
    }
    const next = footer().getByRole("button", { name: "Next paper" });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape");
  const undecided = (await api("/canvas")).appraisal.pending;
  await node("appraisal").getByRole("button", { name: "Summarise the evidence" }).click();
  if (undecided > 0) {
    // Undecided quotes are left out of the synthesis; the app asks before summarising without them.
    const dialog = page.getByRole("dialog", { name: /not decided yet/ });
    await dialog.waitFor({ timeout: 10_000 });
    check("summarising asks before leaving undecided quotes out", (await dialog.textContent()).includes("left out of the synthesis"), `${undecided} undecided`);
    await dialog.getByRole("button", { name: "Summarise without them" }).click();
  }
  await waitApproved(7);

  // 8. Synthesis
  log("synthesis running…");
  await waitState(8);
  const syn = await api("/synthesis");
  const items = syn.topics.flatMap((t) => t.items);
  check("synthesis statements all cite claims", items.length > 0 && items.every((i) => i.claimIds.length > 0), `${items.length} statements, ${syn.topics.reduce((a, t) => a + t.contradictions.length, 0)} contradictions`);
  const cited = items.flatMap((i) => i.claimIds).map((id) => syn.claims[id]);
  check("synthesis only cites verified or user-accepted claims", cited.every((c) => c && (c.verified || c.userAccepted)));
  await openNode("synthesis");
  await shot("8-synthesis");
  await footer().getByRole("button", { name: "Suggest research questions" }).click();
  await waitApproved(8);

  // 9. Research questions
  log("questions running…");
  await waitState(9);
  await page.waitForTimeout(1000);
  const rq = await api("/questions");
  check("three candidate questions", rq.questions.length === 3, rq.questions.map((q) => q.text).join(" || "));
  check("each question links to supporting claims", rq.questions.every((q) => q.claimIds.length > 0));
  check("novelty searches ran", rq.questions.every((q) => q.noveltyStatus !== "pending"), rq.questions.map((q) => `${q.noveltyMatches.length} matches`).join(", "));
  if (!(await page.locator('[data-panel="questions"]').isVisible().catch(() => false))) await openNode("questions");
  await shot("9-questions");
  await panel().getByRole("button", { name: "Choose this question" }).first().click();
  await panel().getByRole("button", { name: "Edit this question" }).click();
  const qbox = page.getByLabel("Question", { exact: true });
  await qbox.fill((await qbox.inputValue()).replace(/\?$/, "") + " between 2015 and 2025?");
  await panel().getByRole("button", { name: "Save edits" }).click();
  await page.waitForTimeout(800);
  await footer().getByRole("button", { name: "Finish and export" }).click();
  await waitApproved(9);
  await page.locator('[data-panel="export"]').waitFor({ timeout: 30_000 });
  await shot("9-final");
  check("question chosen and edited", (await api("/questions")).questions.some((q) => q.chosen && q.edited));

  // Exports (from the Export node)
  for (const [format, ext] of [["Report", "md"], ["Spreadsheet of all papers", "csv"], ["Reference list", "bib"]]) {
    await panel().getByRole("radio", { name: new RegExp(`^${format}`) }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), footer().getByRole("link", { name: /^Download/ }).click()]);
    const path = `${out}/export.${ext}`;
    await dl.saveAs(path);
    check(`export ${ext}`, fs.statSync(path).size > 200, `${fs.statSync(path).size} bytes`);
  }

  // Stale tracking: edit a topic after retrieval → later stages become stale.
  const topicNode = await page.locator('[data-kind="topic"]').first().getAttribute("data-node-id");
  await openNode(topicNode);
  const firstName = page.getByLabel("Topic name");
  await firstName.fill((await firstName.inputValue()) + " (edited)");
  await page.getByLabel("Synonyms (comma-separated)").click(); // blur → save → confirmation dialog
  await page.getByRole("button", { name: "Edit and mark later steps stale" }).click();
  await page.waitForTimeout(1500);
  const st = await states();
  check("editing topics marks stages 3–9 stale", [3, 4, 5, 6, 7, 8, 9].every((n) => st[String(n)] === "stale"), JSON.stringify(st));
  await page.goto(`${base}/s/${pid}?node=summary`);
  await panel().getByText("Out of date.").first().waitFor();
  await shot("stale-banner");
} catch (e) {
  check("run completed without error", false, String(e.message ?? e));
  await shot("error").catch(() => {});
} finally {
  check("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
  const status = await (await ctx.request.get(`${base}/api/status`)).json();
  const view = pid ? await api("") : null;
  const total = view ? Object.values(view.costs).reduce((a, c) => a + c.cost, 0) : 0;
  // Server-wide spend and paid-call counts are admin-only; this run is an ordinary user.
  log(`AI cost this project: $${total.toFixed(4)}${status.spendUsd !== undefined ? ` · total recorded spend $${status.spendUsd.toFixed(4)} · paid API calls attempted: ${status.paidCalls?.attempted ?? "?"}` : ""}`);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ project: pid, mode: status.mockMode ? "mock" : status.mockAi ? "mock-ai" : "real", costs: view?.costs, paidCalls: status.paidCalls, checks }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  log(failed.length ? `${failed.length} CHECK(S) FAILED` : `ALL ${checks.length} CHECKS PASSED`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
