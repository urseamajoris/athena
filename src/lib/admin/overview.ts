import "server-only";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, gt, inArray, ne, notInArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { config, paidCalls } from "../config";
import { totalSpend } from "../ai/client";
import { modelResolutions } from "../ai/models";
import { aiSwitch, budgetSetting, keyStatus } from "../settings";
import { STAGES } from "../shared/stages";
import { studyGroupOf, STUDY_GROUPS } from "../shared/categories";
import { BROWSER } from "./client-errors";
import { abandonment, dailySeries, frontierOf, funnel, furthestOf, percentile, progressCounts, projectExhaustion, projectsPerUser, verdict } from "./metrics";
import { maskEmail } from "../auth/policy";

const H = 3600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const g = globalThis as unknown as { __bootAt?: number };
g.__bootAt ??= Date.now();

async function dbHealth() {
  const t0 = Date.now();
  try {
    const pc = await db.get<{ page_count: number }>(sql`PRAGMA page_count`);
    const ps = await db.get<{ page_size: number }>(sql`PRAGMA page_size`);
    const remote = !!process.env.TURSO_DATABASE_URL?.trim();
    let size = pc && ps ? Number(pc.page_count) * Number(ps.page_size) : null;
    if (!remote && size === null) {
      try {
        size = fs.statSync(path.resolve(process.cwd(), config.databasePath)).size;
      } catch {}
    }
    return { ok: true, kind: remote ? "Turso (libSQL)" : "Local SQLite file", sizeBytes: size, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, kind: process.env.TURSO_DATABASE_URL ? "Turso (libSQL)" : "Local SQLite file", sizeBytes: null, latencyMs: Date.now() - t0, error: (e as Error).message.slice(0, 200) };
  }
}

/**
 * Everything on the admin dashboard, in one read. Aggregates and metadata only: never research ideas, paper
 * titles, notes, prompts, API keys or password hashes. Per-user detail is counts.
 */
export async function adminOverview() {
  const now = Date.now();
  const since30 = iso(now - 30 * D);
  const since24 = iso(now - 24 * H);
  const sinceHour = iso(now - H);

  const [database, ai, budget, key, spent] = await Promise.all([dbHealth(), aiSwitch(), budgetSetting(), keyStatus(), totalSpend()]);

  // ---- users ----
  const users = await db.select({ id: schema.users.id, role: schema.users.role, disabled: schema.users.disabled, createdAt: schema.users.createdAt, lastActiveAt: schema.users.lastActiveAt }).from(schema.users).all();
  const projects = await db.select({ id: schema.projects.id, ownerId: schema.projects.ownerId, stageStates: schema.projects.stageStates, status: schema.projects.status, updatedAt: schema.projects.updatedAt, createdAt: schema.projects.createdAt }).from(schema.projects).all();
  const perUser = new Map<string, number>();
  for (const p of projects) if (p.ownerId) perUser.set(p.ownerId, (perUser.get(p.ownerId) ?? 0) + 1);
  const active = (ms: number) => users.filter((u) => u.lastActiveAt && Date.parse(u.lastActiveAt) >= now - ms).length;

  // ---- AI ----
  // Rows logged by the old scripted (mock) model were never sent to xAI: they are left out of every count.
  const notMock = sql`coalesce(${schema.aiCalls.costSource}, '') <> 'mock'`;
  const totals = await db
    .select({
      status: schema.aiCalls.status,
      n: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)`,
      input: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens}),0)`,
      cached: sql<number>`coalesce(sum(${schema.aiCalls.cachedTokens}),0)`,
      output: sql<number>`coalesce(sum(${schema.aiCalls.outputTokens}),0)`,
      reasoning: sql<number>`coalesce(sum(${schema.aiCalls.reasoningTokens}),0)`,
      retries: sql<number>`sum(case when ${schema.aiCalls.attempt} > 1 then 1 else 0 end)`,
    })
    .from(schema.aiCalls)
    .where(notMock)
    .groupBy(schema.aiCalls.status)
    .all();
  const sum = (k: "n" | "cost" | "input" | "cached" | "output" | "reasoning" | "retries", f: (s: string) => boolean = () => true) => totals.filter((t) => f(t.status)).reduce((a, t) => a + Number(t[k] ?? 0), 0);
  const recentCalls = await db
    .select({ createdAt: schema.aiCalls.createdAt, costUsd: schema.aiCalls.costUsd, stage: schema.aiCalls.stage, model: schema.aiCalls.model, prompt: schema.aiCalls.promptName, version: schema.aiCalls.promptVersion, status: schema.aiCalls.status, durationMs: schema.aiCalls.durationMs })
    .from(schema.aiCalls)
    .where(and(gt(schema.aiCalls.createdAt, since30), notMock))
    .all();
  // One definition of "AI calls" everywhere on the dashboard: calls sent to the model. Calls refused because AI
  // was switched off or the budget was reached are logged too, but never sent; they are counted only as "blocked".
  const isBlocked = (status: string) => status === "refused" || status === "paused";
  const sentCalls = recentCalls.filter((c) => !isBlocked(c.status));
  const group = <K extends string>(key: (r: (typeof recentCalls)[number]) => K) => {
    const m = new Map<K, { calls: number; cost: number; failed: number }>();
    for (const r of sentCalls) {
      const k = key(r);
      const e = m.get(k) ?? { calls: 0, cost: 0, failed: 0 };
      e.calls++;
      e.cost += r.costUsd;
      if (r.status !== "ok") e.failed++;
      m.set(k, e);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  };
  const lat = sentCalls.map((c) => c.durationMs).filter((x) => x > 0);
  const callTotal = sum("n");
  const sent = sum("n", (s) => !isBlocked(s));

  // ---- requests (this app's API) ----
  // Browser error reports share the table (method BROWSER); they are not API requests.
  const notBrowser = ne(schema.requestMetrics.method, BROWSER);
  const reqHour = await db.select({ status: schema.requestMetrics.status, ms: schema.requestMetrics.durationMs }).from(schema.requestMetrics).where(and(notBrowser, gt(schema.requestMetrics.createdAt, sinceHour))).all();
  // 503 is the deliberate "AI is paused" refusal, not a fault: it is not counted as a server error.
  const isErr = (st: number) => st >= 500 && st !== 503;
  const err5xx = reqHour.filter((r) => isErr(r.status)).length;
  const reqDays = await db
    .select({ day: sql<string>`substr(${schema.requestMetrics.createdAt},1,10)`, n: sql<number>`count(*)`, errors: sql<number>`sum(case when ${schema.requestMetrics.status} >= 500 and ${schema.requestMetrics.status} != 503 then 1 else 0 end)` })
    .from(schema.requestMetrics)
    .where(and(notBrowser, gt(schema.requestMetrics.createdAt, iso(now - 14 * D))))
    .groupBy(sql`substr(${schema.requestMetrics.createdAt},1,10)`)
    .all();
  const recentErrors = await db
    .select({ at: schema.requestMetrics.createdAt, route: schema.requestMetrics.route, method: schema.requestMetrics.method, status: schema.requestMetrics.status, error: schema.requestMetrics.error })
    .from(schema.requestMetrics)
    .where(and(gt(schema.requestMetrics.status, 499), ne(schema.requestMetrics.status, 503)))
    .orderBy(desc(schema.requestMetrics.createdAt))
    .limit(20)
    .all();

  // ---- errors in users' browsers (reported by ClientErrorReporter) ----
  const browser = eq(schema.requestMetrics.method, BROWSER);
  const clientHour = await db
    .select({ page: schema.requestMetrics.route, message: schema.requestMetrics.error, n: sql<number>`count(*)` })
    .from(schema.requestMetrics)
    .where(and(browser, gt(schema.requestMetrics.createdAt, sinceHour)))
    .groupBy(schema.requestMetrics.route, schema.requestMetrics.error)
    .orderBy(desc(sql`count(*)`))
    .all();
  const clientErrorsHour = clientHour.reduce((a, r) => a + Number(r.n), 0);
  const recentClientErrors = await db
    .select({ at: schema.requestMetrics.createdAt, page: schema.requestMetrics.route, message: schema.requestMetrics.error })
    .from(schema.requestMetrics)
    .where(browser)
    .orderBy(desc(schema.requestMetrics.createdAt))
    .limit(20)
    .all();

  // ---- data sources ----
  const src = await db.select().from(schema.sourceRequests).where(gt(schema.sourceRequests.createdAt, since24)).all();
  const sources = ["pubmed", "openalex", "crossref", "unpaywall", "europepmc", "pdf"].map((s) => {
    const rows = src.filter((r) => r.source === s);
    const live = rows.filter((r) => !r.cached && !r.simulated);
    const ms = live.map((r) => r.durationMs).filter((x) => x > 0);
    return {
      source: s,
      requests: rows.length,
      live: live.length,
      cached: rows.filter((r) => r.cached).length,
      errors: rows.filter((r) => !r.ok).length,
      rateLimited: rows.filter((r) => r.status === 429).length,
      simulated: rows.filter((r) => r.simulated).length,
      errorRate: rows.length ? rows.filter((r) => !r.ok).length / rows.length : 0,
      cacheHitRate: rows.length ? rows.filter((r) => r.cached).length / rows.length : 0,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      simulatedFailure: config.simulateFailure.includes(s),
    };
  });

  // ---- jobs ----
  const jobs = await db.select({ id: schema.jobs.id, kind: schema.jobs.kind, stage: schema.jobs.stage, status: schema.jobs.status, startedAt: schema.jobs.startedAt, endedAt: schema.jobs.endedAt, heartbeatAt: schema.jobs.heartbeatAt, createdAt: schema.jobs.createdAt, resumeCount: schema.jobs.resumeCount, error: schema.jobs.error }).from(schema.jobs).where(gt(schema.jobs.createdAt, since30)).all();
  const stuck = jobs.filter((j) => j.status === "running" && j.heartbeatAt && now - Date.parse(j.heartbeatAt) > 10 * 60_000).length;
  const byKind = [...new Set(jobs.map((j) => j.kind))].map((k) => {
    const js = jobs.filter((j) => j.kind === k);
    const durs = js.filter((j) => j.startedAt && j.endedAt && j.status === "done").map((j) => (Date.parse(j.endedAt!) - Date.parse(j.startedAt!)) / 1000);
    return { kind: k, runs: js.length, done: js.filter((j) => j.status === "done").length, failed: js.filter((j) => j.status === "failed").length, paused: js.filter((j) => j.status === "paused").length, cancelled: js.filter((j) => j.status === "cancelled").length, p50Sec: percentile(durs, 50), p95Sec: percentile(durs, 95) };
  });
  // Job errors are generic runner messages (no project content); trimmed regardless.
  const failedJobs = jobs.filter((j) => j.status === "failed").sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? "")).slice(0, 10).map((j) => ({ at: j.endedAt ?? j.createdAt, kind: j.kind, stage: j.stage, error: (j.error ?? "").slice(0, 160) }));

  // ---- quality ----
  const claims = await db
    .select({ verified: schema.claims.verified, accepted: schema.claims.userAccepted, rejected: schema.claims.userRejected, notReported: schema.claims.notReported, n: sql<number>`count(*)` })
    .from(schema.claims)
    .groupBy(schema.claims.verified, schema.claims.userAccepted, schema.claims.userRejected, schema.claims.notReported)
    .all();
  const cl = (f: (c: (typeof claims)[number]) => boolean) => claims.filter((c) => !c.notReported && f(c)).reduce((a, c) => a + c.n, 0);
  const apps = await db.select({ source: schema.appraisals.textSource, n: sql<number>`count(*)` }).from(schema.appraisals).where(eq(schema.appraisals.status, "done")).groupBy(schema.appraisals.textSource).all();
  const studies = await db.select({ st: schema.paperSummaries.studyType, n: sql<number>`count(*)` }).from(schema.paperSummaries).groupBy(schema.paperSummaries.studyType).all();
  const studyCounts = STUDY_GROUPS.map((c) => ({ key: c.key, label: c.label, n: studies.filter((s) => studyGroupOf(s.st) === c.key).reduce((a, s) => a + s.n, 0) }));
  const staleRows = await db.select({ after: schema.decisionLog.after }).from(schema.decisionLog).where(and(eq(schema.decisionLog.action, "downstream_marked_stale"), gt(schema.decisionLog.createdAt, since30))).all();
  const staleByStage = STAGES.map((s) => ({ stage: s.n, title: s.title, times: staleRows.filter((r) => ((r.after as { stages?: number[] } | null)?.stages ?? []).includes(s.n)).length }));

  // ---- audit ----
  const audit = await db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.createdAt)).limit(60).all();
  const ids = [...new Set(audit.flatMap((a) => [a.actorId, a.targetId]).filter(Boolean) as string[])];
  const emails = new Map((ids.length ? await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ids)).all() : []).map((u) => [u.id, u.email]));
  const failedLogins24 = (await db.select({ n: sql<number>`count(*)` }).from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "login_failed"), gt(schema.auditEvents.createdAt, since24))).get())?.n ?? 0;

  const models = Object.values(modelResolutions());
  const modelProblems = models.filter((m) => m.status === "substituted" || (/failed/.test(m.note) && config.production)).map((m) => `Model ${m.role}: ${m.note}`);
  const exhaustion = projectExhaustion(sentCalls, spent, budget.limitUsd, now);

  return {
    generatedAt: iso(now),
    mode: { production: config.production },
    verdict: verdict({
      dbOk: database.ok,
      requestsLastHour: reqHour.length,
      errors5xxLastHour: err5xx,
      clientErrorsLastHour: clientErrorsHour,
      topClientError: clientHour[0] ? { page: clientHour[0].page, message: clientHour[0].message ?? "" } : null,
      stuckJobs: stuck,
      pausedJobs: jobs.filter((j) => j.status === "paused").length,
      aiEnabled: ai.enabled,
      spent,
      limit: budget.limitUsd,
      sourceErrorRates: sources.map((s) => ({ source: s.source, requests: s.requests, errorRate: s.errorRate })),
      keyProblem: key.problem ?? (key.inUse === "none" ? "No xAI key is configured: AI steps are paused until one is added." : null),
      modelProblems,
    }),
    health: {
      instance: {
        uptimeSec: Math.round(process.uptime()),
        bootAt: iso(g.__bootAt!),
        node: process.version,
        region: process.env.VERCEL_REGION ?? null,
        memory: (({ rss, heapUsed, heapTotal }) => ({ rss, heapUsed, heapTotal }))(process.memoryUsage()),
        note: process.env.VERCEL ? "Vercel runs several short-lived instances; uptime and memory are for the instance that answered." : null,
      },
      database,
      jobs: { queued: jobs.filter((j) => j.status === "queued").length, running: jobs.filter((j) => j.status === "running").length, paused: jobs.filter((j) => j.status === "paused").length, stuck },
      clientErrors: { lastHour: clientErrorsHour },
      requests: { lastHour: reqHour.length, errors5xx: err5xx, errorRate: reqHour.length ? err5xx / reqHour.length : 0, p50Ms: percentile(reqHour.map((r) => r.ms), 50), p95Ms: percentile(reqHour.map((r) => r.ms), 95), byDay: dailySeries(reqDays, 14, now, (r) => `${r.day}T00:00:00Z`, (r) => r.n), errorsByDay: dailySeries(reqDays, 14, now, (r) => `${r.day}T00:00:00Z`, (r) => r.errors) },
    },
    ai: {
      enabled: ai.enabled,
      changedAt: ai.changedAt,
      changedBy: ai.changedBy ? emails.get(ai.changedBy) ?? (await db.select({ e: schema.users.email }).from(schema.users).where(eq(schema.users.id, ai.changedBy)).get())?.e ?? "a deleted account" : null,
      key,
      paidCalls,
      models,
      budget: { ...budget, spentUsd: spent, pct: budget.limitUsd > 0 ? spent / budget.limitUsd : 0, ...exhaustion },
      totals: {
        calls: callTotal,
        sent,
        ok: sum("n", (s) => s === "ok"),
        invalid: sum("n", (s) => s === "invalid"),
        errors: sum("n", (s) => s === "error"),
        refused: sum("n", (s) => s === "refused"),
        paused: sum("n", (s) => s === "paused"),
        blocked: sum("n", isBlocked),
        costUsd: sum("cost"),
        tokens: { input: sum("input"), cached: sum("cached"), output: sum("output"), reasoning: sum("reasoning") },
        retryRate: sent ? sum("retries") / sent : 0,
        failureRate: sent ? (sum("n", (s) => s === "invalid" || s === "error")) / sent : 0,
      },
      latency: { p50: percentile(lat, 50), p90: percentile(lat, 90), p99: percentile(lat, 99) },
      byDay: dailySeries(sentCalls, 14, now, (r) => r.createdAt, (r) => r.costUsd),
      callsByDay: dailySeries(sentCalls, 14, now, (r) => r.createdAt),
      byStage: group((r) => (r.stage ? `${r.stage}. ${STAGES[r.stage - 1]?.title ?? ""}` : "other")),
      byModel: group((r) => r.model),
      byPrompt: group((r) => `${r.prompt} ${r.version.startsWith("v") ? r.version : `v${r.version}`}`),
    },
    users: {
      total: users.length,
      admins: users.filter((u) => u.role === "admin").length,
      disabled: users.filter((u) => u.disabled).length,
      active24h: active(24 * H),
      active7d: active(7 * D),
      signupsByDay: dailySeries(users, 14, now, (u) => u.createdAt),
      projectsPerUser: projectsPerUser(users.map((u) => perUser.get(u.id) ?? 0)),
      projects: projects.length,
      // One rule for every progress count: "reached" and "finished" are high-water marks (see furthestOf).
      ...progressCounts(projects),
      funnel: funnel(projects),
      abandonment: abandonment(projects, now),
      failedLogins24h: failedLogins24,
    },
    sources,
    jobs: { byKind, failed: failedJobs, resumedAfterRestart: jobs.reduce((a, j) => a + (j.resumeCount ?? 0), 0) },
    quality: {
      quotes: { verified: cl((c) => c.verified), unverified: cl((c) => !c.verified), acceptedUnverified: cl((c) => !c.verified && c.accepted), rejected: cl((c) => c.rejected) },
      appraisals: { fullText: apps.find((a) => a.source === "full_text")?.n ?? 0, abstractOnly: apps.find((a) => a.source === "abstract")?.n ?? 0 },
      studyTypes: studyCounts,
      staleByStage,
    },
    errors: { requests: recentErrors, jobs: failedJobs, client: recentClientErrors },
    audit: audit.map((a) => {
      const actor = a.actorId ? emails.get(a.actorId) ?? "deleted account" : null;
      const target = a.targetId ? emails.get(a.targetId) ?? null : null;
      // Admins see full addresses here, so a masked copy of one already shown beside it is dropped; it stays when
      // it is the only clue (a failed login for an unknown address, a deleted account).
      const shown = [actor, target].filter((e): e is string => !!e && e.includes("@")).map(maskEmail);
      const detail = a.detail && Object.fromEntries(Object.entries(a.detail).filter(([k, v]) => !(k === "email" && typeof v === "string" && shown.includes(v.toLowerCase()))));
      return { id: a.id, at: a.createdAt, category: a.category, action: a.action, actor, target, detail };
    }),
  };
}
export type AdminOverview = Awaited<ReturnType<typeof adminOverview>>;

/** Users for the admin table: account metadata and counts, never project content. */
export async function adminUsers() {
  const users = await db.select().from(schema.users).orderBy(desc(schema.users.createdAt)).all();
  const projects = await db.select({ ownerId: schema.projects.ownerId, stageStates: schema.projects.stageStates, status: schema.projects.status }).from(schema.projects).all();
  const cost = await db
    .select({ ownerId: schema.projects.ownerId, calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)` })
    .from(schema.aiCalls)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.aiCalls.projectId))
    // Sent calls only, the same definition as the dashboard's "AI calls" (blocked attempts were never sent).
    .where(notInArray(schema.aiCalls.status, ["refused", "paused"]))
    .groupBy(schema.projects.ownerId)
    .all();
  return users.map((u) => {
    const mine = projects.filter((p) => p.ownerId === u.id);
    const c = cost.find((x) => x.ownerId === u.id);
    // The furthest step any of their projects reached (the dashboard's high-water rule), and where that project is now.
    const top = mine.map((p) => ({ furthest: furthestOf(p), now: frontierOf(p.stageStates) })).sort((a, b) => b.furthest - a.furthest || b.now - a.now)[0];
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      disabled: u.disabled,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt,
      lastActiveAt: u.lastActiveAt,
      projects: mine.length,
      furthestStage: top?.furthest ?? null,
      currentStage: top?.now ?? null,
      aiCalls: c?.calls ?? 0,
      costUsd: c?.cost ?? 0,
    };
  });
}
