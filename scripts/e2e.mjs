// End-to-end UI test with no xAI key: drives the canvas like a student would, as far as the app goes without AI.
// Usage: node scripts/e2e.mjs [baseUrl] [--out=dir]
// Run it against a server with no xAI key (XAI_API_KEY empty, no key set in the admin dashboard). It reads
// /api/status first and refuses to run if the server has a key, so it never spends. With the server's
// ADMIN_EMAIL / ADMIN_PASSWORD in this environment it also checks server-wide that no AI call was sent.
// Without a key every AI step stops before any request to xAI; steps past the search builder need AI output and
// are covered only by a real run with a key.
import { createRequire } from "node:module";
import fs from "node:fs";
import { Client } from "./lib/client.mjs";
import { isAiRefusalLog, requireNoKey } from "./lib/no-key.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // pre-installed Playwright (CommonJS resolution honours NODE_PATH)

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const out = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "e2e-artifacts/run";
fs.mkdirSync(out, { recursive: true });
const IDEA = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
const TOPICS = ["Telemedicine adoption in ASEAN countries", "Barriers and facilitators for health workers", "Rural and underserved patients", "Policy and infrastructure readiness"];
const NOT_SET_UP = /AI is not set up/i;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  log(ok ? "✓" : "✗", name, detail);
};

// Refuses to go on (exit 2) if the server has an xAI key. As the admin it also notes the spend so far.
const { status: statusBefore, client: checker } = await requireNoKey(base);
const admin = statusBefore.keys ? checker : null;
const overviewBefore = admin ? await admin.json("/api/admin/overview") : null;
log(`server has no xAI key${admin ? ` · recorded spend so far $${statusBefore.spendUsd.toFixed(4)}` : " (set ADMIN_EMAIL / ADMIN_PASSWORD for the server-wide spend checks)"}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
// Console errors are kept with their URL: the browser logs every refused AI step (HTTP 503) as a failed
// resource load, which is the expected answer here, not an app error.
const consoleErrors = [];
const refusedUrls = new Set();
page.on("console", (m) => m.type() === "error" && consoleErrors.push({ text: m.text().slice(0, 200), url: m.location()?.url ?? "" }));
page.on("pageerror", (e) => consoleErrors.push({ text: String(e).slice(0, 200), url: "" }));
page.on("response", (r) => r.status() === 503 && r.url().includes("/api/projects/") && refusedUrls.add(r.url()));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
let pid;
// API reads go through the browser context, so they carry the signed-in user's session cookie.
const api = async (path) => (await ctx.request.get(`${base}/api/projects/${pid}${path}`)).json();
const states = async () => (await api("")).project.stageStates;
const panel = () => page.locator("[data-panel]");
const node = (id) => page.locator(`[data-node-id="${id}"]`);
const footer = () => page.locator("[data-panel-footer]");

async function waitApproved(n, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const s = (await states())[String(n)];
    if (s === "approved") return;
    if (Date.now() > end) throw new Error(`timeout waiting for stage ${n} to be approved (state ${s})`);
    await page.waitForTimeout(500);
  }
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
/** How many elements on screen match `re` (a message may already be on screen, so callers compare counts). */
async function visibleCount(re, scope = page) {
  const l = scope.getByText(re);
  let n = 0;
  for (let i = 0; i < (await l.count()); i++) if (await l.nth(i).isVisible().catch(() => false)) n++;
  return n;
}
async function waitForMore(re, before, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await visibleCount(re)) > before) return true;
    await page.waitForTimeout(300);
  }
  return false;
}
const SPINNERS = /Preparing the first question|Thinking about the next question|Writing the searches/;

try {
  // 0. Accounts: a new user signs up through the UI (the landing's call to action), then lands on the empty canvas.
  await page.goto(`${base}/`);
  await page.getByRole("link", { name: "Start a review" }).click();
  await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.org`);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/s\/new/);

  // 1. Idea: the empty canvas. Saving the idea needs no AI.
  await page.getByLabel("Describe your research idea").fill(IDEA);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/s\/prj_/);
  pid = page.url().match(/\/s\/(prj_[a-z0-9]+)/)[1];
  log("project", pid);
  await node("idea").waitFor();
  check("the idea is saved", (await api("")).project.idea === IDEA);
  await shot("1-idea");

  // 2. "Sharpen my idea" approves the idea; the first scoping question needs AI, so the panel says it is not set up.
  await node("idea").getByRole("button", { name: "Sharpen my idea" }).click();
  await waitApproved(1);
  await panel().waitFor();
  const said = await panel().getByText(NOT_SET_UP).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check("“Sharpen my idea” shows the plain AI-not-set-up message", said);
  await page.waitForTimeout(3000);
  check("no spinner is left running after the refusal", (await visibleCount(SPINNERS)) === 0);
  check("no scoping question was stored", (await api("/scoping")).messages.length === 0);
  await shot("2-not-set-up");

  // 3. Topics by hand: skip the questions, add topics, edit one, delete one, then approve them.
  await menu("Skip remaining questions");
  await page.waitForTimeout(800);
  check("the scoping questions can be skipped", (await api("/scoping")).done === true);
  for (const name of TOPICS) {
    await openNode("idea");
    await menu("Add a topic");
    const dialog = page.getByRole("dialog", { name: "Add a topic" });
    await dialog.getByLabel("Topic name").fill(name);
    await dialog.getByRole("button", { name: "Add topic" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.locator('[data-kind="topic"]', { hasText: name }).first().waitFor();
  }
  let topics = (await api("/scoping")).topics;
  check("topics can be added by hand", topics.length === TOPICS.length && topics.every((t) => t.origin === "user"), topics.map((t) => t.name).join(" | "));
  await shot("3-topics");

  const first = topics[0];
  await openNode(`topic:${first.id}`);
  const nameBox = panel().getByLabel("Topic name");
  await nameBox.fill(`${first.name} in primary care`);
  const syn = panel().getByLabel("Synonyms (comma-separated)");
  await syn.click(); // blur → the name saves
  await syn.fill("teleconsultation, eHealth, telehealth");
  await nameBox.click(); // blur → the synonyms save
  await page.waitForTimeout(1200);
  const edited = (await api("/scoping")).topics.find((t) => t.id === first.id);
  check("a topic can be edited by hand", edited?.name === `${first.name} in primary care` && edited?.synonyms.includes("eHealth"), edited ? `${edited.name} · ${edited.synonyms.join(", ")}` : "topic missing");

  const last = topics[topics.length - 1];
  await openNode(`topic:${last.id}`);
  await menu("Delete topic");
  await node(`topic:${last.id}`).waitFor({ state: "detached" });
  topics = (await api("/scoping")).topics;
  check("a topic can be deleted", topics.length === TOPICS.length - 1 && !topics.some((t) => t.id === last.id));

  await openNode("idea");
  await footer().getByRole("button", { name: "Use these topics" }).click();
  await waitApproved(2);
  check("topics can be approved by hand without AI", (await states())["2"] === "approved");

  // 4. Search builder: writing the searches needs AI, so it says AI is not set up and writes nothing.
  await page.keyboard.press("Escape");
  const before = await visibleCount(NOT_SET_UP);
  await page.locator('[data-kind="topic"]').first().getByRole("button", { name: "Write the searches" }).click();
  check("the search builder shows the AI-not-set-up message", await waitForMore(NOT_SET_UP, before));
  await page.waitForTimeout(3000);
  check("no spinner is left running after the refusal", (await visibleCount(SPINNERS)) === 0);
  const search = await api("/search");
  check("no searches were written and step 3 stays open", search.topics.every((t) => t.queries.length === 0) && (await states())["3"] !== "approved");
  await shot("4-search-not-set-up");

  // 5. Nothing was spent: every AI call of this project was refused before any request to xAI.
  const view = await api("");
  const costs = Object.values(view.costs ?? {});
  const calls = costs.reduce((a, c) => a + c.calls, 0);
  const cost = costs.reduce((a, c) => a + c.cost, 0);
  check("nothing was spent: AI cost $0 and every AI call was refused", cost === 0 && calls > 0 && costs.every((c) => c.failures === c.calls), `${calls} refused calls, $${cost.toFixed(4)}`);

  // 6. Isolation: another account cannot open this project, by API or by page.
  const other = await new Client(base, "other").signup(`e2e-other-${Date.now()}@example.org`);
  const otherApi = await other.raw(`/api/projects/${pid}`);
  const otherPage = await (await other.raw(`/s/${pid}`)).text();
  check("another account cannot open the project", otherApi.status === 404 && !otherPage.includes(IDEA.slice(0, 40)), `API ${otherApi.status}`);

  // 7. Exports of what exists (the idea and the topics). The full-page views carry the not-set-up banner.
  await page.goto(`${base}/s/${pid}/export`);
  const banner = await page.getByText("AI is not set up yet.").first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("the export page shows the “AI is not set up yet.” banner", banner);
  for (const [format, ext] of [["Report", "md"], ["Spreadsheet of all papers", "csv"], ["Reference list", "bib"]]) {
    await page.getByRole("radio", { name: new RegExp(`^${format}`) }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("main").getByRole("link", { name: /^Download/ }).first().click()]);
    const path = `${out}/export.${ext}`;
    await dl.saveAs(path);
    const failure = await dl.failure();
    if (ext === "md") {
      const md = fs.readFileSync(path, "utf8");
      check("export md has the idea and the topics", !failure && md.includes(IDEA.slice(0, 40)) && topics.every((t) => md.includes(t.name)), `${md.length} bytes`);
    } else check(`export ${ext} downloads`, !failure && fs.existsSync(path), failure ?? `${fs.statSync(path).size} bytes`);
  }
  await shot("7-export");

  // 8. Editing an approved topic reopens step 2 (stale tracking, as far as it goes without AI).
  await page.goto(`${base}/s/${pid}`);
  await openNode(`topic:${topics[1].id}`);
  const box = panel().getByLabel("Topic name");
  await box.fill(`${topics[1].name} (edited)`);
  await panel().getByLabel("Synonyms (comma-separated)").click(); // blur → save
  const guard = page.getByRole("button", { name: "Edit and mark later steps stale" });
  if (await guard.isVisible({ timeout: 1500 }).catch(() => false)) await guard.click();
  await page.waitForTimeout(1200);
  check("editing an approved topic reopens step 2", (await states())["2"] === "needs_review");

  // 9. The account menu: the account page shows $0.00 of AI use; settings say AI is not set up.
  await page.goto(`${base}/sessions`);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("menuitem", { name: "Account" }).click();
  await page.waitForURL(/\/account/);
  await page.getByRole("heading", { name: "Your account" }).waitFor();
  await page.getByText(/AI calls? across/).waitFor();
  check("the account menu opens the account page, which shows $0.00 of AI use", (await page.getByText(/costing \$0\.00/).count()) > 0);
  await shot("9-account");
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings/);
  const settingsSay = await page.getByText("AI not set up: no xAI key").first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("settings say AI is not set up", settingsSay);
  await shot("9-settings");
} catch (e) {
  check("run completed without error", false, String(e.message ?? e));
  await shot("error").catch(() => {});
} finally {
  const unexpected = consoleErrors.filter((c) => !isAiRefusalLog(c.text, c.url, refusedUrls));
  check("no browser console errors", unexpected.length === 0, unexpected.length ? unexpected.slice(0, 5).map((c) => c.text).join(" | ") : `${consoleErrors.length} expected refusal logs (HTTP 503) ignored`);
  const view = pid ? await api("").catch(() => null) : null;
  const total = view ? Object.values(view.costs).reduce((a, c) => a + c.cost, 0) : 0;
  let statusAfter = null;
  if (admin) {
    statusAfter = await admin.json("/api/status");
    const overviewAfter = await admin.json("/api/admin/overview");
    check("server-wide: no AI call reached xAI and nothing was spent during the run", overviewAfter.ai.totals.sent === overviewBefore.ai.totals.sent && statusAfter.spendUsd === statusBefore.spendUsd, `sent ${overviewBefore.ai.totals.sent} → ${overviewAfter.ai.totals.sent}, spend $${statusBefore.spendUsd.toFixed(4)} → $${statusAfter.spendUsd.toFixed(4)}`);
  }
  log(`AI cost this project: $${total.toFixed(4)}${statusAfter ? ` · total recorded spend $${statusAfter.spendUsd.toFixed(4)} · paid API calls attempted: ${statusAfter.paidCalls?.attempted ?? "?"}` : ""}`);
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ project: pid, mode: "no-key", costs: view?.costs, paidCalls: statusAfter?.paidCalls, checks }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  log(failed.length ? `${failed.length} CHECK(S) FAILED` : `ALL ${checks.length} CHECKS PASSED`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
}
