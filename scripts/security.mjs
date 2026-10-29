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

// 6. Account deletion removes the user's projects.
const C = await new Client(base).signup(`sec-c-${stamp}@example.org`);
const pc = (await C.json("/api/projects", { body: { idea: "Does green space exposure reduce stress in city workers?" } })).id;
const del = await C.raw("/api/account", { method: "DELETE", body: { password: "test-password-123", confirm: "DELETE" } });
const afterDel = await A.raw(`/api/projects/${pc}`);
const relog = await new Client(base).raw("/api/auth/login", { body: { email: `sec-c-${stamp}@example.org`, password: "test-password-123" } });
check("deleting an account deletes its projects and its login", del.status === 200 && afterDel.status === 404 && relog.status === 401, `${del.status}/${afterDel.status}/${relog.status}`);

const extra = process.env.SECURITY_EXTRA ? await import(process.env.SECURITY_EXTRA) : null;
if (extra?.default) await extra.default({ base, check, Client, A, B, anon, pa, stamp });

const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\n${failed.length} CHECK(S) FAILED` : `\nALL ${checks.length} SECURITY CHECKS PASSED`);
process.exit(failed.length ? 1 : 0);
