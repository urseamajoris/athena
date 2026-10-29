// Security and data-isolation test against a running server (mock mode). Costs nothing.
// Usage: node scripts/security.mjs [baseUrl]   (admin checks need ADMIN_EMAIL / ADMIN_PASSWORD of that server)
//
// Every project route is read from src/lib/api.ts, so a route added later is covered automatically.
// - anonymous requests get 401 on every route;
// - user B gets 404 on every route of user A's project (and A's project never appears in B's list or pages);
// - IDs of A's objects (papers, scores, claims, appraisals, synthesis items, questions, topics, queries)
//   never resolve inside B's own project, and A's data is unchanged afterwards;
// - cross-site writes are refused, login is rate-limited, session cookies are HttpOnly.
import fs from "node:fs";
import { Client } from "./lib/client.mjs";
import { runFlow } from "./api-flow.mjs";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000";
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(ok ? "✓" : "✗", name, detail ? `— ${detail}` : "");
};
const stamp = Date.now();

const ROUTES = [...fs.readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8").matchAll(/\bon\("(GET|POST|PATCH|PUT|DELETE)", "([^"]+)"/g)].map((m) => ({ method: m[1], path: m[2] }));
check("router routes discovered", ROUTES.length >= 40, `${ROUTES.length} routes`);

const A = await new Client(base, "A").signup(`sec-a-${stamp}@example.org`);
const B = await new Client(base, "B").signup(`sec-b-${stamp}@example.org`);
const anon = new Client(base, "anon");

console.log("building user A's project (mock pipeline)…");
const pa = await runFlow(A, { until: 9 });
const pb = (await B.json("/api/projects", { body: { idea: "How does screen time affect sleep quality in teenagers?" } })).id;

// A's object IDs, gathered through A's own (legitimate) reads.
const g = (p) => A.json(`/api/projects/${pa}/${p}`);
const [papers, ranking, appraisals, synthesis, questions, scoping, search] = await Promise.all([g("papers"), g("ranking"), g("appraisals"), g("synthesis"), g("questions"), g("scoping"), g("search")]);
const firstAppraisal = appraisals.appraisals[0];
const detail = await g(`appraisals/${firstAppraisal.id}`);
const scoreRows = ranking.rows ?? ranking.topics?.flatMap((t) => t.rows ?? t.papers ?? []) ?? [];
const scoreId = JSON.stringify(ranking).match(/"(sc_[a-z0-9]+|score_[a-z0-9]+)"/)?.[1] ?? scoreRows[0]?.scoreId ?? scoreRows[0]?.id;
const ids = {
  pid: papers.papers[0].id,
  sid: JSON.stringify(synthesis).match(/"(sy_[a-f0-9]+)"/)?.[1] ?? "sy_missing",
  aid: firstAppraisal.id,
  cid: detail.claims[0].id,
  qid: questions.questions[0].id,
  tid: scoping.topics[0].id,
  kind: "markdown",
  n: "5",
};
const queryId = search.topics[0].queries[0].id;
check("collected A's object IDs", Object.values(ids).every((v) => v && !String(v).includes("missing")) && !!scoreId && !!queryId, JSON.stringify({ ...ids, scoreId, queryId }));

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

const snapshot = async () => JSON.stringify(await Promise.all([g("papers"), g("ranking"), g("synthesis"), g("questions"), g(`appraisals/${firstAppraisal.id}`), g("scoping"), A.json(`/api/projects/${pa}`).then((v) => v.project)]));
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

// 3. A's object IDs inside B's own project never resolve.
bad = [];
for (const r of ROUTES.filter((x) => x.path.includes(":") || ["ranking/select", "ranking/swap", "topics/merge"].includes(x.path))) {
  if (r.path === "stages/:n/approve" || r.path === "stages/:n/run" || r.path === "stages/:n/cancel" || r.path === "stages/:n/keep" || r.path === "stages/:n/reopen" || r.path === "export/:kind") continue; // not object IDs
  const res = await B.raw(`/api/projects/${pb}/${fill(r.path)}`, { method: r.method, body: bodyFor(r) });
  if (res.status < 400 || res.status >= 500) bad.push(`${r.method} ${r.path} → ${res.status}`);
}
check("IDs from another project never resolve inside my project", bad.length === 0, bad.join("; "));
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
  const titles = papers.papers.slice(0, 20).map((p) => p.title.slice(0, 30));
  check("the dashboard never contains research ideas or paper titles", !ovText.includes(ideaA.slice(0, 30)) && titles.every((t) => !ovText.includes(t)));
  check("the dashboard never contains password hashes", !/scrypt\$/.test(ovText));
  check("the dashboard counts the users and projects this test created", ov.users.total >= 3 && ov.users.projects >= 2 && ov.ai.totals.calls > 0, `${ov.users.total} users, ${ov.users.projects} projects, ${ov.ai.totals.calls} AI calls`);

  // The xAI key: stored encrypted, never returned, never logged, never exported.
  const SAMPLE = `xai-SAMPLE${stamp}TESTKEYdoNotUse0123456789`;
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
  for (const f of [process.env.SECURITY_DB, process.env.SECURITY_DB && `${process.env.SECURITY_DB}-wal`, process.env.SECURITY_LOG].filter(Boolean)) {
    if (fs.existsSync(f) && fs.readFileSync(f).includes(Buffer.from(SAMPLE))) leaks.push(`file ${f.split("/").pop()}`);
  }
  check("the key never appears in a response, export, the database file or the server log", leaks.length === 0, leaks.length ? `leaked in: ${leaks.join(", ")}` : `checked ${process.env.SECURITY_DB ? "responses, exports, database and log" : "responses and exports (set SECURITY_DB / SECURITY_LOG to scan files too)"}`);
  const ks = await admin.json("/api/admin/key");
  check("the admin-set key is in use and shown masked", ks.inUse === "admin" && ks.masked === `••••${SAMPLE.slice(-4)}`, `${ks.inUse} ${ks.masked}`);
  const tested = await admin.json("/api/admin/key/test", { body: {} });
  check("Test key records a result (outside production it makes no request)", !!tested.lastTest && typeof tested.lastTest.message === "string", tested.lastTest?.message);
  const cleared = await admin.json("/api/admin/key", { method: "DELETE" });
  check("clearing the key falls back to the environment key", cleared.inUse !== "admin" && !cleared.admin, cleared.inUse);

  // AI off switch: AI steps refused (no call, no cost, no mock fallback), retrieval still works, jobs pause and resume.
  await admin.json("/api/admin/ai", { body: { enabled: false } });
  const pd = (await A.json("/api/projects", { body: { idea: "Does peer tutoring improve exam results for first-year nursing students?" } })).id;
  await A.json(`/api/projects/${pd}/stages/1/approve`, { body: {} });
  const off = await A.raw(`/api/projects/${pd}/scoping/start`, { body: {} });
  const offBody = await off.json();
  check("with AI off, an AI step is refused with the paused message", off.status === 503 && offBody.kind === "ai_paused" && /paused by the administrator/i.test(offBody.error), `${off.status} ${offBody.error}`);
  const wait = async (c, pid, n, want, ms = 60_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await c.json(`/api/projects/${pid}`);
      if (want(v.project.stageStates[String(n)], v.jobs[String(n)]?.status)) return v;
      if (Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  await A.json(`/api/projects/${pa}/stages/4/run`, { body: { force: true } });
  const r4 = await wait(A, pa, 4, (s) => s === "needs_review");
  check("with AI off, database retrieval (no AI) still runs", r4.project.stageStates["4"] === "needs_review", r4.project.stageStates["4"]);
  await A.json(`/api/projects/${pa}/stages/4/approve`, { body: {} });
  await A.json(`/api/projects/${pa}/stages/5/run`, { body: { force: true } });
  const p5 = await wait(A, pa, 5, (_s, j) => j === "paused");
  check("with AI off, a running AI job pauses cleanly (not failed)", p5.jobs["5"]?.status === "paused" && p5.project.stageStates["5"] === "running", `${p5.jobs["5"]?.status} / ${p5.project.stageStates["5"]}`);
  const ovOff = await admin.json("/api/admin/overview");
  check("the dashboard shows AI off and the refused calls", ovOff.ai.enabled === false && ovOff.ai.totals.paused > 0 && ovOff.verdict.level !== "green", `paused calls ${ovOff.ai.totals.paused}, verdict ${ovOff.verdict.level}`);
  const on = await admin.json("/api/admin/ai", { body: { enabled: true } });
  const r5 = await wait(A, pa, 5, (s) => s === "needs_review");
  check("turning AI back on resumes the paused job", on.resumedJobs >= 1 && r5.project.stageStates["5"] === "needs_review", `resumed ${on.resumedJobs}, stage 5 ${r5.project.stageStates["5"]}`);
  check("after resuming, AI steps work again", (await A.raw(`/api/projects/${pd}/scoping/start`, { body: {} })).status === 200);

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
} else {
  console.log("(admin checks skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to the server's admin)");
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} CHECK(S) FAILED` : `\nALL ${checks.length} SECURITY CHECKS PASSED`);
process.exit(failed.length ? 1 : 0);
