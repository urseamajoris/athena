import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "./project";
import { STAGES } from "./shared/stages";
import { AiValidationError, BudgetError } from "./ai/client";
import { startJob, cancelJob } from "./jobs";
import { addTopic, answerScoping, approveTopics, deleteTopic, generateTopics, mergeTopics, nextScopingTurn, scopingState, skipScoping, updateTopic } from "./stages/scoping";
import { buildQueries, dryRun, dryRunAll, searchState, updateCriteria, updateQuery } from "./stages/search";
import { appraisalDetail, appraisalsView, canvasView, claimsView, decisionLogView, paperDetail, papersView, projectView, questionsView, rankingView, retrievalView, synthesisView } from "./views";
import { markdownReport, selectedBibtex, summaryCsv } from "./export";
import { runNovelty } from "./jobs/questions";
import { reverifyProject } from "./jobs/appraisal";
import { nowIso, errMsg } from "./util";
import { STUDY_TYPES } from "./shared/stages";

type Handler = (ctx: { projectId: string; params: Record<string, string>; body: unknown; url: URL }) => Promise<unknown> | unknown;
interface Route { method: string; pattern: string[]; handler: Handler }
const routes: Route[] = [];
const on = (method: string, path: string, handler: Handler) => routes.push({ method, pattern: path.split("/").filter(Boolean), handler });

function parse<T>(s: z.ZodType<T>, body: unknown): T {
  const r = s.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof BudgetError) return NextResponse.json({ error: e.message, kind: "budget" }, { status: 402 });
  if (e instanceof AiValidationError) return NextResponse.json({ error: e.message, kind: "ai_validation" }, { status: 502 });
  console.error("[athena] API error", e);
  return NextResponse.json({ error: errMsg(e) }, { status: 500 });
}

export async function dispatch(req: Request, projectId: string, path: string[]) {
  try {
    getProject(projectId);
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    for (const r of routes) {
      if (r.method !== method || r.pattern.length !== path.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      r.pattern.forEach((seg, i) => {
        if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(path[i]);
        else if (seg !== path[i]) ok = false;
      });
      if (!ok) continue;
      const body = method === "GET" ? null : await req.json().catch(() => ({}));
      const out = await r.handler({ projectId, params, body, url });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    }
    return NextResponse.json({ error: `No route ${method} /${path.join("/")}` }, { status: 404 });
  } catch (e) {
    return errorResponse(e);
  }
}

// ---------- stages ----------
const JOB_STAGES: Record<number, string> = Object.fromEntries(STAGES.filter((s) => s.job).map((s) => [s.n, s.job!]));

function requireUpstreamApproved(projectId: string, n: number) {
  const p = getProject(projectId);
  for (let i = 1; i < n; i++) {
    if (p.stageStates[String(i)] !== "approved") throw new HttpError(409, `Approve stage ${i} (${STAGES[i - 1].title}) first.`);
  }
}

on("POST", "stages/:n/approve", ({ projectId, params }) => {
  const n = Number(params.n);
  requireUpstreamApproved(projectId, n);
  const p = getProject(projectId);
  const state = p.stageStates[String(n)];
  if (state === "running") throw new HttpError(409, "This stage is still running.");
  if (n === 1 && !p.idea.trim()) throw new HttpError(400, "Write your idea first.");
  if (n === 2) approveTopics(projectId);
  if (n === 3 && !db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all().length) throw new HttpError(400, "Build the queries first.");
  if (n === 9) {
    const chosen = db.select().from(schema.researchQuestions).where(and(eq(schema.researchQuestions.projectId, projectId), eq(schema.researchQuestions.chosen, true))).get();
    if (!chosen) throw new HttpError(400, "Pick one research question first.");
  }
  if (JOB_STAGES[n] && (state === "not_started" || state === "failed")) throw new HttpError(409, "Run this stage before approving it.");
  setStageState(projectId, n, "approved", { currentStage: Math.min(9, n + 1) });
  logDecision(projectId, n, "stage_approved");
  // Kick off the next stage's background job if it has never run.
  const next = n + 1;
  if (JOB_STAGES[next] && getProject(projectId).stageStates[String(next)] === "not_started") {
    startJob(projectId, JOB_STAGES[next], next);
  }
  if (n === 9) db.update(schema.projects).set({ status: "complete", updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run();
  return projectView(projectId);
});

on("POST", "stages/:n/run", ({ projectId, params, body }) => {
  const n = Number(params.n);
  requireUpstreamApproved(projectId, n);
  if (!JOB_STAGES[n]) throw new HttpError(400, "This stage has no background job.");
  const jobId = startJob(projectId, JOB_STAGES[n], n, (body as Record<string, unknown>) ?? {});
  logDecision(projectId, n, "stage_run_requested", null, body);
  return { jobId };
});

on("POST", "stages/:n/cancel", ({ projectId, params }) => {
  const n = Number(params.n);
  const j = db.select().from(schema.jobs).where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, n))).all().filter((x) => x.status === "running" || x.status === "queued");
  j.forEach((x) => cancelJob(x.id));
  setStageState(projectId, n, "failed");
  logDecision(projectId, n, "stage_cancelled");
  return { cancelled: j.length };
});

/** Keep stale results: the stage returns to "needs review" so the user re-checks and approves it. */
on("POST", "stages/:n/keep", ({ projectId, params }) => {
  const n = Number(params.n);
  const p = getProject(projectId);
  if (p.stageStates[String(n)] !== "stale") throw new HttpError(409, "Stage is not stale.");
  setStageState(projectId, n, "needs_review");
  logDecision(projectId, n, "stale_results_kept", p.staleReasons[String(n)] ?? null);
  return projectView(projectId);
});

/** User is about to edit an approved stage: reopen it (and warn the UI about downstream). */
on("POST", "stages/:n/reopen", ({ projectId, params }) => {
  const n = Number(params.n);
  const p = getProject(projectId);
  if (p.stageStates[String(n)] === "approved") setStageState(projectId, n, "needs_review", { currentStage: n });
  logDecision(projectId, n, "stage_reopened_for_edit");
  return projectView(projectId);
});

// ---------- stage 1 ----------
on("PATCH", "idea", ({ projectId, body }) => {
  const { idea } = parse(z.object({ idea: z.string().trim().min(10, "Please write at least a sentence.").max(4000) }), body);
  const p = getProject(projectId);
  if (p.idea === idea) return projectView(projectId);
  db.update(schema.projects).set({ idea, title: idea.slice(0, 90), updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run();
  logDecision(projectId, 1, "idea_edited", p.idea, idea);
  markDownstreamStale(projectId, 1, "The research idea was edited");
  return projectView(projectId);
});

// ---------- stage 2 ----------
on("GET", "scoping", ({ projectId }) => scopingState(projectId));
on("POST", "scoping/start", async ({ projectId }) => {
  const s = scopingState(projectId);
  if (s.messages.length) return s;
  return nextScopingTurn(projectId);
});
on("POST", "scoping/restart", async ({ projectId }) => {
  db.delete(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).run();
  logDecision(projectId, 2, "scoping_restarted");
  setStageState(projectId, 2, "needs_review");
  return nextScopingTurn(projectId);
});
on("POST", "scoping/answer", async ({ projectId, body }) => {
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), body);
  return answerScoping(projectId, text);
});
on("POST", "scoping/skip", ({ projectId }) => skipScoping(projectId));
on("POST", "scoping/topics", async ({ projectId }) => generateTopics(projectId));

const TopicPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), synonyms: z.array(z.string().max(120)).max(30).optional(), controlledTerms: z.array(z.string().max(120)).max(20).optional(), rationale: z.string().max(400).optional() });
on("POST", "topics", ({ projectId, body }) => ({ id: addTopic(projectId, parse(TopicPatch.extend({ name: z.string().trim().min(1).max(120) }), body)), state: scopingState(projectId) }));
on("PATCH", "topics/:tid", ({ projectId, params, body }) => {
  updateTopic(projectId, params.tid, parse(TopicPatch, body));
  return scopingState(projectId);
});
on("DELETE", "topics/:tid", ({ projectId, params }) => {
  deleteTopic(projectId, params.tid);
  return scopingState(projectId);
});
on("POST", "topics/merge", ({ projectId, body }) => {
  const { ids, name } = parse(z.object({ ids: z.array(z.string()).min(2), name: z.string().trim().min(1).max(120) }), body);
  mergeTopics(projectId, ids, name);
  return scopingState(projectId);
});

// ---------- stage 3 ----------
on("GET", "search", ({ projectId }) => searchState(projectId));
on("POST", "search/build", async ({ projectId }) => buildQueries(projectId));
on("PATCH", "queries/:qid", ({ projectId, params, body }) => {
  const { queryString } = parse(z.object({ queryString: z.string().trim().min(2).max(4000) }), body);
  updateQuery(projectId, params.qid, queryString);
  return searchState(projectId);
});
on("POST", "queries/:qid/dryrun", async ({ projectId, params }) => dryRun(projectId, params.qid));
on("POST", "search/dryrun-all", async ({ projectId }) => ({ results: await dryRunAll(projectId), state: searchState(projectId) }));
const CriteriaSchema = z.object({
  yearFrom: z.number().int().min(1900).max(2100).nullable(),
  yearTo: z.number().int().min(1900).max(2100).nullable(),
  languages: z.array(z.string().trim().min(1).max(20)).max(10),
  studyTypes: z.array(z.string().trim().min(1).max(80)).max(20),
  inclusion: z.array(z.string().trim().min(1).max(300)).max(20),
  exclusion: z.array(z.string().trim().min(1).max(300)).max(20),
});
on("PUT", "criteria", ({ projectId, body }) => {
  updateCriteria(projectId, parse(CriteriaSchema, body));
  return searchState(projectId);
});

// ---------- stage 4 ----------
on("GET", "retrieval", ({ projectId }) => retrievalView(projectId));

// ---------- stage 5 ----------
on("GET", "papers", ({ projectId }) => papersView(projectId));
on("GET", "papers/:pid", ({ projectId, params }) => {
  const d = paperDetail(projectId, params.pid);
  if (!d) throw new HttpError(404, "Paper not found");
  return d;
});
on("PATCH", "papers/:pid/summary", ({ projectId, params, body }) => {
  const patch = parse(z.object({ studyType: z.enum(STUDY_TYPES).optional(), setting: z.string().trim().min(1).max(300).optional(), keyFinding: z.string().trim().min(1).max(500).optional() }), body);
  const s = db.select().from(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, params.pid)).get();
  if (!s) throw new HttpError(404, "Summary not found");
  db.update(schema.paperSummaries).set({ ...patch, edited: true }).where(eq(schema.paperSummaries.id, s.id)).run();
  logDecision(projectId, 5, "summary_cell_edited", { studyType: s.studyType, setting: s.setting, keyFinding: s.keyFinding }, patch);
  markDownstreamStale(projectId, 5, "A summary-table cell was corrected");
  return { ok: true };
});

// ---------- stage 6 ----------
on("GET", "ranking", ({ projectId }) => rankingView(projectId));
on("POST", "ranking/select", ({ projectId, body }) => {
  const { scoreId, selected } = parse(z.object({ scoreId: z.string(), selected: z.boolean() }), body);
  const s = db.select().from(schema.scores).where(eq(schema.scores.id, scoreId)).get();
  if (!s) throw new HttpError(404, "Score not found");
  db.update(schema.scores).set({ selected, userChanged: true }).where(eq(schema.scores.id, scoreId)).run();
  logDecision(projectId, 6, selected ? "paper_selected" : "paper_deselected", { paperId: s.paperId, topicId: s.topicId, selected: s.selected }, { selected });
  markDownstreamStale(projectId, 6, "The selected papers changed");
  return rankingView(projectId);
});
on("POST", "ranking/swap", ({ projectId, body }) => {
  const { outId, inId } = parse(z.object({ outId: z.string(), inId: z.string() }), body);
  const a = db.select().from(schema.scores).where(eq(schema.scores.id, outId)).get();
  const b = db.select().from(schema.scores).where(eq(schema.scores.id, inId)).get();
  if (!a || !b || a.topicId !== b.topicId) throw new HttpError(400, "Both papers must be in the same topic.");
  db.update(schema.scores).set({ selected: false, userChanged: true }).where(eq(schema.scores.id, outId)).run();
  db.update(schema.scores).set({ selected: true, userChanged: true }).where(eq(schema.scores.id, inId)).run();
  logDecision(projectId, 6, "papers_swapped", { out: a.paperId }, { in: b.paperId, topicId: a.topicId });
  markDownstreamStale(projectId, 6, "The selected papers changed");
  return rankingView(projectId);
});

// ---------- stage 7 ----------
on("GET", "appraisals", ({ projectId }) => appraisalsView(projectId));
on("GET", "appraisals/:aid", ({ projectId, params }) => {
  const d = appraisalDetail(projectId, params.aid);
  if (!d) throw new HttpError(404, "Appraisal not found");
  return d;
});
on("PATCH", "claims/:cid", ({ projectId, params, body }) => {
  const patch = parse(z.object({ decision: z.enum(["accept", "reject", "clear"]).optional(), statement: z.string().trim().min(1).max(600).optional() }), body);
  const c = db.select().from(schema.claims).where(eq(schema.claims.id, params.cid)).get();
  if (!c) throw new HttpError(404, "Claim not found");
  const set: Partial<typeof schema.claims.$inferInsert> = {};
  if (patch.decision === "accept") Object.assign(set, { userAccepted: true, userRejected: false });
  if (patch.decision === "reject") Object.assign(set, { userAccepted: false, userRejected: true });
  if (patch.decision === "clear") Object.assign(set, { userAccepted: false, userRejected: false });
  if (patch.statement) set.statement = patch.statement;
  db.update(schema.claims).set(set).where(eq(schema.claims.id, c.id)).run();
  logDecision(projectId, 7, `claim_${patch.decision ?? "edited"}`, { verified: c.verified, accepted: c.userAccepted, rejected: c.userRejected, statement: c.statement }, set);
  markDownstreamStale(projectId, 7, "An appraisal claim was accepted, rejected or edited");
  return appraisalDetail(projectId, c.appraisalId);
});
on("POST", "appraisals/reverify", ({ projectId }) => {
  const r = reverifyProject(projectId);
  logDecision(projectId, 7, "quotes_reverified", null, r, "system");
  if (r.changed) markDownstreamStale(projectId, 7, `Quote re-check changed ${r.changed} claim(s)`);
  return r;
});
on("POST", "appraisals/:aid/redo", ({ projectId, params }) => {
  const a = db.select().from(schema.appraisals).where(eq(schema.appraisals.id, params.aid)).get();
  if (!a) throw new HttpError(404, "Appraisal not found");
  return { jobId: startJob(projectId, "appraisal", 7, { paperIds: [a.paperId] }) };
});

// ---------- stage 8 ----------
on("GET", "synthesis", ({ projectId }) => synthesisView(projectId));
on("PATCH", "synthesis/:sid", ({ projectId, params, body }) => {
  const { statement } = parse(z.object({ statement: z.string().trim().min(1).max(600) }), body);
  const s = db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.id, params.sid)).get();
  if (!s) throw new HttpError(404, "Not found");
  db.update(schema.synthesisItems).set({ statement, edited: true }).where(eq(schema.synthesisItems.id, s.id)).run();
  logDecision(projectId, 8, "synthesis_edited", s.statement, statement);
  markDownstreamStale(projectId, 8, "A synthesis statement was edited");
  return synthesisView(projectId);
});

// ---------- stage 9 ----------
on("GET", "questions", ({ projectId }) => questionsView(projectId));
on("PATCH", "questions/:qid", ({ projectId, params, body }) => {
  const patch = parse(z.object({ text: z.string().trim().min(5).max(600).optional(), structure: z.record(z.string(), z.string().max(400)).optional(), design: z.string().max(300).optional(), feasibility: z.string().max(800).optional(), weakness: z.string().max(600).optional() }), body);
  const q = db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.id, params.qid)).get();
  if (!q) throw new HttpError(404, "Not found");
  db.update(schema.researchQuestions).set({ ...patch, edited: true }).where(eq(schema.researchQuestions.id, q.id)).run();
  logDecision(projectId, 9, "question_edited", { text: q.text, structure: q.structure }, patch);
  if (getProject(projectId).stageStates["9"] === "approved") setStageState(projectId, 9, "needs_review");
  return questionsView(projectId);
});
on("POST", "questions/:qid/choose", ({ projectId, params }) => {
  db.update(schema.researchQuestions).set({ chosen: false }).where(eq(schema.researchQuestions.projectId, projectId)).run();
  db.update(schema.researchQuestions).set({ chosen: true }).where(eq(schema.researchQuestions.id, params.qid)).run();
  logDecision(projectId, 9, "question_chosen", null, { id: params.qid });
  return questionsView(projectId);
});
on("POST", "questions/:qid/novelty", async ({ projectId, params }) => {
  const reviewed = new Set(db.select({ t: schema.papers.normTitle }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all().map((r) => r.t));
  await runNovelty(params.qid, reviewed, () => {});
  return questionsView(projectId);
});

// ---------- canvas ----------
on("GET", "canvas", ({ projectId }) => canvasView(projectId));
on("GET", "claims", ({ projectId }) => claimsView(projectId));

// ---------- misc ----------
on("GET", "log", ({ projectId }) => decisionLogView(projectId));
on("GET", "export/:kind", ({ projectId, params }) => {
  const p = getProject(projectId);
  const slug = (p.title || "review").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const send = (body: string, type: string, ext: string) =>
    new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${slug}.${ext}"` } });
  logDecision(projectId, 9, "exported", null, { kind: params.kind }, "user");
  if (params.kind === "markdown") return send(markdownReport(projectId), "text/markdown", "md");
  if (params.kind === "csv") return send(summaryCsv(projectId), "text/csv", "csv");
  if (params.kind === "bibtex") return send(selectedBibtex(projectId), "application/x-bibtex", "bib");
  throw new HttpError(404, "Unknown export");
});
