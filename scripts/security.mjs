// Security and data-isolation test against a running server with no xAI key. Costs nothing.
// Usage: node scripts/security.mjs [baseUrl]   (admin checks need ADMIN_EMAIL / ADMIN_PASSWORD of that server)
//
// It reads /api/status first and refuses to run if the server has an xAI key, so every AI step is refused before
// any request to xAI. User A's project is built by hand (idea, skipped questions, topics), without AI.
// Every project route is read from src/lib/api.ts, so a route added later is covered automatically.
// - anonymous requests get 401 on every route;
// - user B gets 404 on every route of user A's project (and A's project never appears in B's list or pages);
// - IDs of A's topics never resolve inside B's own project, and A's data is unchanged afterwards;
// - cross-site writes are refused, login is rate-limited, session cookies are HttpOnly;
// - with no key, and with AI switched off, AI steps are refused (503, no cost) and the project is unchanged.
//
// Dropped when mock mode was removed, because they need AI output (a real run with a key covers them):
// - IDs of papers, ranking scores, claims, appraisals, synthesis items and questions not resolving inside another
//   project (without AI there are none; those routes are still in the 401 and 404 sweeps);
// - with AI off, database retrieval still runs, and a running AI job pauses and resumes when AI is back on;
// - after AI is back on, AI steps work again;
// - the dashboard never contains paper titles (topic names are checked instead).
import fs from "node:fs";
import { Client } from "./lib/client.mjs";
import { requireNoKey } from "./lib/no-key.mjs";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(ok ? "✓" : "✗", name, detail ? `— ${detail}` : "");
};
const stamp = Date.now();

// Refuses to go on (exit 2) if the server has an xAI key.
const { status: statusBefore } = await requireNoKey(base);

const ROUTES = [...fs.readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8").matchAll(/\bon\("(GET|POST|PATCH|PUT|DELETE)", "([^"]+)"/g)].map((m) => ({ method: m[1], path: m[2] }));
check("router routes discovered", ROUTES.length >= 40, `${ROUTES.length} routes`);

const A = await new Client(base, "A").signup(`sec-a-${stamp}@example.org`);
const B = await new Client(base, "B").signup(`sec-b-${stamp}@example.org`);
const anon = new Client(base, "anon");

console.log("building user A's project by hand (no AI)…");
const IDEA_A = "What is the knowledge gap in implementing telemedicine in Southeast Asia?";
const TOPICS = [
  { name: "Telemedicine adoption in ASEAN countries", synonyms: ["telehealth", "teleconsultation"], rationale: "The main phenomenon." },
  { name: "Barriers and facilitators for health workers", synonyms: ["obstacles", "enablers"], rationale: "What blocks or helps it." },
  { name: "Rural and underserved patients", synonyms: ["remote areas"], rationale: "The population that matters most." },
];
const pa = (await A.json("/api/projects", { body: { idea: IDEA_A } })).id;
await A.json(`/api/projects/${pa}/stages/1/approve`, { body: {} });
const refused = await A.raw(`/api/projects/${pa}/scoping/start`, { body: {} });
const refusedBody = await refused.json().catch(() => ({}));
check("with no xAI key, an AI step is refused with the not-set-up message", refused.status === 503 && refusedBody.kind === "ai_paused" && /not set up/i.test(refusedBody.error ?? ""), `${refused.status} ${refusedBody.error ?? ""}`);
await A.json(`/api/projects/${pa}/scoping/skip`, { body: {} });
for (const t of TOPICS) await A.json(`/api/projects/${pa}/topics`, { body: t });
await A.json(`/api/projects/${pa}/stages/2/approve`, { body: {} });
const build = await A.raw(`/api/projects/${pa}/search/build`, { body: {} });
const buildBody = await build.json().catch(() => ({}));
check("with no xAI key, the search builder is refused and writes nothing", build.status === 503 && buildBody.kind === "ai_paused" && (await A.json(`/api/projects/${pa}/search`)).topics.every((t) => t.queries.length === 0), `${build.status} ${buildBody.error ?? ""}`);
const pb = (await B.json("/api/projects", { body: { idea: "How does screen time affect sleep quality in teenagers?" } })).id;

// A's object IDs, gathered through A's own (legitimate) reads. Without AI only topics exist; the other object
// routes get made-up IDs, which is enough for the 401 and 404 sweeps (the project is checked first).
const g = (p) => A.json(`/api/projects/${pa}/${p}`);
const scoping = await g("scoping");
check("A's project was built without AI", scoping.topics.length === TOPICS.length && (await A.json(`/api/projects/${pa}`)).project.stageStates["2"] === "approved", `${scoping.topics.length} topics`);
const ids = { pid: "pap_none", sid: "sy_none", aid: "app_none", cid: "cl_none", qid: "rq_none", tid: scoping.topics[0].id, kind: "markdown", n: "5" };
const queryId = "q_none";
const scoreId = "sc_none";

const fill = (path, extra = {}) => path.replace(/:([a-z]+)/g, (_, k) => ({ ...ids, qid: path.startsWith("queries") ? queryId : ids.qid, sid: path.startsWith("ranking/scores") ? scoreId : ids.sid, ...extra })[k] ?? "x");
const bodyFor = (r) => {
  if (r.path === "ranking/select") return { scoreId, selected: false };
  if (r.path === "ranking/swap") return { outId: scoreId, inId: scoreId };
  if (r.path === "topics/merge") return { ids: scoping.topics.slice(0, 2).map((t) => t.id), name: "merged" };
  if (r.path === "claims/:cid") return { decision: "reject" };
  if (r.path === "papers/:pid/summary") return { setting: "tampered" };
  if (r.path === "synthesis/:sid") return { statement: "tampered" };
  if (r.path === "questions/:qid") return { text: "tampered question text" };
  if (r.path === "topics/:tid") return { name: "tampered" };
  if (r.path === "queries/:qid") return { queryString: "tampered" };
  if (r.path === "idea") return { idea: "tampered idea text that is long enough" };
  return r.method === "GET" ? undefined : {};
};

const snapshot = async () => JSON.stringify(await Promise.all([g("scoping"), g("search"), g("papers"), A.json(`/api/projects/${pa}`).then((v) => v.project)]));
const before = await snapshot();

// 1. Anonymous: 401 everywhere.
let bad = [];
for (const r of ROUTES) {
  const res = await anon.raw(`/api/projects/${pa}/${fill(r.path)}`, { method: r.method, body: bodyFor(r) });
  if (res.status !== 401) bad.push(`${r.method} ${r.path} → ${res.status}`);
}
for (const [m, p] of [["GET", "/api/projects"], ["POST", "/api/projects"], ["GET", `/api/projects/${pa}`], ["PATCH", `/api/projects/${pa}`], ["DELETE", `/api/projects/${pa}`], ["GET", `/api/projects/${pa}/events`], ["GET", "/api/status"], ["GET", "/api/account"], ["GET", "/api/account/export"]]) {
  const res = await anon.raw(p, { method: m, body: m === "GET" ? undefined : {} });
  if (res.status !== 401) bad.push(`${m} ${p} → ${res.status}`);
}
check("anonymous requests get 401 on every API route", bad.length === 0, bad.slice(0, 8).join("; "));

// 2. User B against A's project: 404 everywhere (existence is not revealed).
bad = [];
for (const r of ROUTES) {
  const res = await B.raw(`/api/projects/${pa}/${fill(r.path)}`, { method: r.method, body: bodyFor(r) });
  if (res.status !== 404) bad.push(`${r.method} ${r.path} → ${res.status}`);
}
for (const [m, p, body] of [["GET", `/api/projects/${pa}`], ["PATCH", `/api/projects/${pa}`, { title: "x" }], ["DELETE", `/api/projects/${pa}`], ["GET", `/api/projects/${pa}/events`]]) {
  const res = await B.raw(p, { method: m, body: body ?? (m === "GET" ? undefined : {}) });
  if (res.status !== 404) bad.push(`${m} ${p} → ${res.status}`);
}
check("another user gets 404 on every route of a project they do not own", bad.length === 0, bad.slice(0, 8).join("; "));
const bList = await B.json("/api/projects");
check("another user's project is not in my list", !bList.projects.some((p) => p.id === pa) && bList.projects.some((p) => p.id === pb));

// 3. A's topic IDs inside B's own project never resolve (the only object IDs that exist without AI).
bad = [];
for (const r of ROUTES.filter((x) => x.path.includes(":tid") || x.path === "topics/merge")) {
  const res = await B.raw(`/api/projects/${pb}/${fill(r.path)}`, { method: r.method, body: bodyFor(r) });
  if (res.status < 400 || res.status >= 500) bad.push(`${r.method} ${r.path} → ${res.status}`);
}
check("topic IDs from another project never resolve inside my project", bad.length === 0, bad.join("; "));
check("the other user's data is unchanged after all of the above", (await snapshot()) === before);

// 4. Pages: B cannot see A's idea; anonymous is sent to log in.
const page = await B.raw(`/s/${pa}`);
const html = await page.text();
const ideaA = (await A.json(`/api/projects/${pa}`)).project.idea;
check("session page does not render another user's project", !html.includes(ideaA.slice(0, 40)), `status ${page.status}`);
const anonPage = await anon.raw(`/s/${pa}`);
check("anonymous visitors are sent to log in", [302, 303, 307, 308].includes(anonPage.status) && (anonPage.headers.get("location") ?? "").includes("/login"), `${anonPage.status} → ${anonPage.headers.get("location")}`);
const exp = await B.raw(`/api/projects/${pa}/export/markdown`);
check("another user's report cannot be downloaded", exp.status === 404, `status ${exp.status}`);
const expHtml = await B.raw(`/api/projects/${pa}/export/html`);
check("another user's printable report cannot be opened", expHtml.status === 404, `status ${expHtml.status}`);

// 5. Cross-site writes, cookie flags, open redirect, rate limiting.
const xs = await A.raw(`/api/projects/${pa}`, { method: "PATCH", body: { title: "csrf" }, headers: { origin: "https://evil.example" } });
check("cross-site writes are refused", xs.status === 403, `status ${xs.status}`);
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `sec-a-${stamp}@example.org`, password: "test-password-123" }) });
const sc = login.headers.getSetCookie?.().find((c) => c.startsWith("athena_session=")) ?? "";
check("session cookie is HttpOnly and SameSite", /HttpOnly/i.test(sc) && /SameSite=lax/i.test(sc), sc.replace(/=[^;]+/, "=…"));
const nextRedirect = await A.raw(`/login?next=//evil.example`);
check("login ?next= cannot redirect off-site", [302, 303, 307, 308].includes(nextRedirect.status) && (nextRedirect.headers.get("location") ?? "").startsWith("/") && !(nextRedirect.headers.get("location") ?? "").includes("evil.example"), `${nextRedirect.status} ${nextRedirect.headers.get("location") ?? ""}`);
const victim = `sec-rl-${stamp}@example.org`;
await new Client(base).signup(victim);
const codes = [];
for (let i = 0; i < 7; i++) codes.push((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(stamp % 200) + 1}` }, body: JSON.stringify({ email: victim, password: `wrong-${i}` }) })).status);
check("login is rate-limited after repeated failures", codes.slice(0, 5).every((c) => c === 401) && codes.slice(5).every((c) => c === 429), codes.join(","));
const right = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: victim, password: "test-password-123" }) });
check("a locked-out account stays locked even with the right password", right.status === 429, `status ${right.status}`);
const weak = await new Client(base).raw("/api/auth/signup", { body: { email: `sec-weak-${stamp}@example.org`, password: "short" } });
check("weak passwords are refused", weak.status === 400, `status ${weak.status}`);
const dup = await new Client(base).raw("/api/auth/signup", { body: { email: `SEC-A-${stamp}@example.org`, password: "test-password-123" } });
check("an email can only have one account (case-insensitive)", dup.status === 409, `status ${dup.status}`);
if (process.env.ADMIN_EMAIL) {
  const reserved = await new Client(base).raw("/api/auth/signup", { body: { email: process.env.ADMIN_EMAIL.toUpperCase(), password: "someone-else-123" } });
  check("nobody can sign up with the administrator's email", reserved.status === 403, `status ${reserved.status}`);
}

// 6. Account deletion removes the user's projects.
const C = await new Client(base).signup(`sec-c-${stamp}@example.org`);
const pc = (await C.json("/api/projects", { body: { idea: "Does green space exposure reduce stress in city workers?" } })).id;
const del = await C.raw("/api/account", { method: "DELETE", body: { password: "test-password-123", confirm: "DELETE" } });
const afterDel = await A.raw(`/api/projects/${pc}`);
const relog = await new Client(base).raw("/api/auth/login", { body: { email: `sec-c-${stamp}@example.org`, password: "test-password-123" } });
check("deleting an account deletes its projects and its login", del.status === 200 && afterDel.status === 404 && relog.status === 401, `${del.status}/${afterDel.status}/${relog.status}`);

// 7. Admin area (needs the server's ADMIN_EMAIL / ADMIN_PASSWORD in this environment).
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const admin = await new Client(base, "admin").login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const adminDir = new URL("../src/app/api/admin/", import.meta.url);
  const adminRoutes = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir), `${prefix}/${e.name.replace(/^\[(.+)\]$/, "x")}`);
      else if (e.name === "route.ts") for (const m of fs.readFileSync(new URL(e.name, dir), "utf8").matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)) adminRoutes.push({ method: m[1], path: `/api/admin${prefix}` });
    }
  };
  walk(adminDir, "");
  check("admin routes discovered", adminRoutes.length >= 9, adminRoutes.map((r) => `${r.method} ${r.path}`).join(", "));
  const body = (r) => (r.method === "GET" || r.method === "DELETE" ? undefined : r.path.endsWith("/ai") ? { enabled: false } : r.path.endsWith("/budget") ? { limitUsd: 0 } : r.path.endsWith("/key") ? { key: "xai-NOTALLOWEDKEY0000000000000" } : { action: "disable" });
  const a401 = [];
  const a403 = [];
  for (const r of adminRoutes) {
    const p = r.path.replace("/x", `/${"usr_doesnotexist"}`);
    if ((await anon.raw(p, { method: r.method, body: body(r) })).status !== 401) a401.push(`${r.method} ${r.path}`);
    if ((await B.raw(p, { method: r.method, body: body(r) })).status !== 403) a403.push(`${r.method} ${r.path}`);
  }
  check("anonymous gets 401 on every admin route", a401.length === 0, a401.join("; "));
  check("a non-admin gets 403 on every admin route", a403.length === 0, a403.join("; "));
  const adminPage = await B.raw("/admin");
  check("the admin page sends non-admins away", [302, 303, 307, 308].includes(adminPage.status), `status ${adminPage.status}`);
  const st = await B.json("/api/status");
  check("ordinary users do not see spend, budget or key presence", st.spendUsd === undefined && st.keys === undefined && st.budgetUsd === undefined);
  check("admins cannot open another user's project", (await admin.raw(`/api/projects/${pa}`)).status === 404);

  // Privacy: the dashboard shows aggregates, never content.
  const ov = await admin.json("/api/admin/overview");
  const ovText = JSON.stringify(ov) + JSON.stringify(await admin.json("/api/admin/users"));
  const topicNames = scoping.topics.map((t) => t.name.slice(0, 30));
  check("the dashboard never contains research ideas or topic names", !ovText.includes(ideaA.slice(0, 30)) && topicNames.every((t) => !ovText.includes(t)));
  check("the dashboard never contains password hashes", !/scrypt\$/.test(ovText));
  check("the dashboard counts the users, projects and refused AI calls this test created", ov.users.total >= 3 && ov.users.projects >= 2 && ov.ai.totals.calls > 0 && ov.ai.totals.paused > 0, `${ov.users.total} users, ${ov.users.projects} projects, ${ov.ai.totals.calls} AI calls (${ov.ai.totals.paused} refused)`);

  // The xAI key: stored encrypted, never returned, never logged, never exported. The key here is made up, and AI is
  // switched off while it is set: setting a key where there was none resumes paused jobs only while AI is on, so no AI
  // step runs. The server may check the key against xAI's free model list, which rejects it, so nothing is spent.
  const SAMPLE = `xai-SAMPLE${stamp}TESTKEYdoNotUse0123456789`;
  const aiWasOn = ov.ai.enabled;
  // Afterwards (and if anything below throws), the made-up key is cleared and the AI switch is put back as it was.
  const restore = async () => {
    await admin.raw("/api/admin/key", { method: "DELETE" }).catch(() => {});
    await admin.raw("/api/admin/ai", { body: { enabled: aiWasOn } }).catch(() => {});
  };
  try {
    await admin.json("/api/admin/ai", { body: { enabled: false } });
    const put = await admin.raw("/api/admin/key", { method: "PUT", body: { key: SAMPLE } });
    const putText = await put.text();
    check("an admin can set a key, and the response does not contain it", put.status === 200 && !putText.includes(SAMPLE) && putText.includes(SAMPLE.slice(-4)), `status ${put.status}`);
    const leaks = [];
    const scan = async (label, c, path, opts) => { const t = await (await c.raw(path, opts)).text(); if (t.includes(SAMPLE) || t.includes(SAMPLE.slice(4, 20))) leaks.push(label); };
    await scan("overview", admin, "/api/admin/overview");
    await scan("key status", admin, "/api/admin/key");
    await scan("key test", admin, "/api/admin/key/test", { body: {} });
    await scan("users", admin, "/api/admin/users");
    await scan("status", admin, "/api/status");
    await scan("A status", A, "/api/status");
    for (const k of ["markdown", "html", "csv", "bibtex"]) await scan(`export ${k}`, A, `/api/projects/${pa}/export/${k}`);
    await scan("log", A, `/api/projects/${pa}/log`);
    await scan("account export", A, "/api/account/export");
    const ks = await admin.json("/api/admin/key");
    check("the admin-set key is in use and shown masked", ks.inUse === "admin" && ks.masked === `••••${SAMPLE.slice(-4)}`, `${ks.inUse} ${ks.masked}`);
    const cleared = await admin.json("/api/admin/key", { method: "DELETE" });
    check("clearing the key leaves the server with no key (none in the environment)", cleared.inUse === "none" && !cleared.admin, cleared.inUse);
    for (const f of [process.env.SECURITY_DB, process.env.SECURITY_DB && `${process.env.SECURITY_DB}-wal`, process.env.SECURITY_LOG].filter(Boolean)) {
      if (fs.existsSync(f) && fs.readFileSync(f).includes(Buffer.from(SAMPLE))) leaks.push(`file ${f.split("/").pop()}`);
    }
    check("the key never appears in a response, export, the database file or the server log", leaks.length === 0, leaks.length ? `leaked in: ${leaks.join(", ")}` : `checked ${process.env.SECURITY_DB ? "responses, exports, database and log" : "responses and exports (set SECURITY_DB / SECURITY_LOG to scan files too)"}`);
    check("after clearing, /api/status says no key is configured", (await admin.json("/api/status")).ai?.keyMissing === true);
    // Tested with no key, so the test contacts nothing.
    const tested = await admin.json("/api/admin/key/test", { body: {} });
    check("Test key with no key records a result without contacting xAI", !!tested.lastTest && tested.lastTest.ok === false && typeof tested.lastTest.message === "string", tested.lastTest?.message);

    // AI off switch (with no key as well): AI steps refused with no call and no cost; the project stays intact.
    const pd = (await A.json("/api/projects", { body: { idea: "Does peer tutoring improve exam results for first-year nursing students?" } })).id;
    await A.json(`/api/projects/${pd}/stages/1/approve`, { body: {} });
    const intact = async () => (await snapshot()) + JSON.stringify(await Promise.all([A.json(`/api/projects/${pd}/scoping`), A.json(`/api/projects/${pd}`).then((v) => [v.project.idea, v.project.stageStates])]));
    const intactBefore = await intact();
    await admin.json("/api/admin/ai", { body: { enabled: false } });
    const off = await A.raw(`/api/projects/${pd}/scoping/start`, { body: {} });
    const offBody = await off.json().catch(() => ({}));
    check("with AI off, an AI step is refused (503, paused)", off.status === 503 && offBody.kind === "ai_paused" && /paused by the administrator|not set up/i.test(offBody.error ?? ""), `${off.status} ${offBody.error ?? ""}`);
    const offBuild = await A.raw(`/api/projects/${pa}/search/build`, { body: {} });
    check("with AI off, the search builder is refused too", offBuild.status === 503 && (await offBuild.json().catch(() => ({}))).kind === "ai_paused", `status ${offBuild.status}`);
    const ovOff = await admin.json("/api/admin/overview");
    check("the dashboard shows AI off and the refused calls", ovOff.ai.enabled === false && ovOff.ai.totals.paused > ov.ai.totals.paused && ovOff.verdict.level !== "green", `refused calls ${ov.ai.totals.paused} → ${ovOff.ai.totals.paused}, verdict ${ovOff.verdict.level}`);
    const on = await admin.json("/api/admin/ai", { body: { enabled: true } });
    check("AI can be switched back on", on.enabled === true && (await admin.json("/api/status")).ai?.enabled === true);
    const stillOff = await A.raw(`/api/projects/${pd}/scoping/start`, { body: {} });
    const stillBody = await stillOff.json().catch(() => ({}));
    check("with AI on but no key, AI steps are still refused with the not-set-up message", stillOff.status === 503 && stillBody.kind === "ai_paused" && /not set up/i.test(stillBody.error ?? ""), `${stillOff.status} ${stillBody.error ?? ""}`);
    check("the refused AI steps left the project data intact", (await intact()) === intactBefore);
    const pdView = await A.json(`/api/projects/${pd}`);
    const pdCosts = Object.values(pdView.costs ?? {});
    check("refused AI steps cost nothing", pdCosts.every((c) => c.cost === 0 && c.failures === c.calls) && pdCosts.reduce((a, c) => a + c.calls, 0) > 0, pdCosts.map((c) => `${c.calls} calls $${c.cost}`).join(", "));
  } finally {
    await restore();
  }

  // Budget: raising above the server's limit needs an explicit confirmation; every change is logged.
  const env = ov.ai.budget.envUsd;
  const above = await admin.raw("/api/admin/budget", { method: "PUT", body: { limitUsd: env + 5 } });
  check("raising the limit above XAI_BUDGET_USD needs confirmation", above.status === 409 && (await above.json()).kind === "confirm_needed", `status ${above.status}`);
  const lower = await admin.json("/api/admin/budget", { method: "PUT", body: { limitUsd: Math.max(0, env - 1) } });
  const restored = await admin.json("/api/admin/budget", { method: "PUT", body: { limitUsd: null } });
  check("an admin can lower and restore the limit", lower.limitUsd === Math.max(0, env - 1) && restored.limitUsd === env && !restored.override, `${lower.limitUsd} → ${restored.limitUsd}`);

  // Account actions.
  const users = (await admin.json("/api/admin/users")).users;
  const bRow = users.find((u) => u.email === `sec-b-${stamp}@example.org`);
  await admin.json(`/api/admin/users/${bRow.id}`, { body: { action: "disable" } });
  check("a disabled user is logged out at once", (await B.raw("/api/projects")).status === 401);
  check("a disabled user cannot log in", (await new Client(base).raw("/api/auth/login", { body: { email: bRow.email, password: "test-password-123" } })).status === 403);
  await admin.json(`/api/admin/users/${bRow.id}`, { body: { action: "enable" } });
  const reset = await admin.json(`/api/admin/users/${bRow.id}`, { body: { action: "reset_password" } });
  const B2 = new Client(base);
  const relogin = await B2.json("/api/auth/login", { body: { email: bRow.email, password: reset.temporaryPassword } });
  check("a reset password works once and forces a new password", !!reset.temporaryPassword && relogin.mustChangePassword === true);
  const me = users.find((u) => u.email === process.env.ADMIN_EMAIL.toLowerCase());
  check("an admin cannot remove their own admin role", (await admin.raw(`/api/admin/users/${me.id}`, { body: { action: "set_role", role: "user" } })).status === 409);
  await admin.json(`/api/admin/users/${bRow.id}`, { body: { action: "set_role", role: "admin" } });
  check("role changes take effect", (await B2.raw("/api/admin/overview")).status === 200);
  await admin.json(`/api/admin/users/${bRow.id}`, { body: { action: "set_role", role: "user" } });
  check("…and can be undone", (await B2.raw("/api/admin/overview")).status === 403);
  const audit = (await admin.json("/api/admin/overview")).audit.map((a) => a.action);
  const want = ["xai_key_set", "xai_key_tested", "xai_key_cleared", "ai_disabled", "ai_enabled", "budget_changed", "user_disabled", "user_enabled", "password_reset", "role_changed", "login_failed"];
  check("every admin action and security event is in the audit log", want.every((w) => audit.includes(w)), want.filter((w) => !audit.includes(w)).join(", ") || "all present");
  const statusAfter = await admin.json("/api/status");
  check("nothing was spent during the run", statusAfter.spendUsd === statusBefore.spendUsd, `recorded spend $${statusBefore.spendUsd?.toFixed(4)} → $${statusAfter.spendUsd?.toFixed(4)}`);
} else {
  console.log("(admin checks skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to the server's admin)");
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} CHECK(S) FAILED` : `\nALL ${checks.length} SECURITY CHECKS PASSED`);
process.exit(failed.length ? 1 : 0);
