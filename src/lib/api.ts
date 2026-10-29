import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "./project";
import { STAGES } from "./shared/stages";
import { requireUser, ownedProject } from "./auth/server";
import { startJob, cancelJob } from "./jobs";
import { addTopic, answerScoping, approveTopics, deleteTopic, generateTopics, mergeTopics, nextScopingTurn, scopingState, skipScoping, updateTopic } from "./stages/scoping";
import { buildQueries, dryRun, dryRunAll, searchState, updateCriteria, updateQuery } from "./stages/search";
import { paperPointsView, appraisalDetail, appraisalsView, canvasView, claimsView, decisionLogView, paperDetail, papersTableView, projectView, questionsView, rankingTableView, retrievalView, synthesisView } from "./views";
import { markdownReport, selectedBibtex, summaryCsv } from "./export";
import { runNovelty } from "./jobs/questions";
import { reverifyProject } from "./jobs/appraisal";
import { nowIso, forEachSeq } from "./util";
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

/**
 * Every project route: the caller must be signed in and own the project (another user's project is a 404,
 * for admins too). Objects addressed by ID inside the project (papers, scores, claims, ...) are checked
 * against the project as well, so an ID from another project never resolves.
 */
export async function dispatch(req: Request, projectId: string, path: string[]): Promise<Response> {
  const user = await requireUser();
  await ownedProject(projectId, user);
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
}

/** The route pattern a request matched (for telemetry: never the IDs themselves). */
export function routePattern(method: string, path: string[]): string {
  const r = routes.find((x) => x.method === method.toUpperCase() && x.pattern.length === path.length && x.pattern.every((seg, i) => seg.startsWith(":") || seg === path[i]));
  return r ? r.pattern.join("/") : "unknown";
}

// ---------- ownership of objects inside a project ----------
async function ownPaper(projectId: string, paperId: string) {
  const p = await db.select({ id: schema.papers.id }).from(schema.papers).where(and(eq(schema.papers.id, paperId), eq(schema.papers.projectId, projectId))).get();
  if (!p) throw new HttpError(404, "Paper not found");
}
async function ownScore(projectId: string, scoreId: string) {
  const s = await db.select().from(schema.scores).where(eq(schema.scores.id, scoreId)).get();
  const t = s && (await db.select({ id: schema.topics.id }).from(schema.topics).where(and(eq(schema.topics.id, s.topicId), eq(schema.topics.projectId, projectId))).get());
  if (!s || !t) throw new HttpError(404, "Score not found");
  return s;
}
async function ownClaim(projectId: string, claimId: string) {
  const c = await db.select().from(schema.claims).where(eq(schema.claims.id, claimId)).get();
  if (!c) throw new HttpError(404, "Claim not found");
  await ownPaper(projectId, c.paperId).catch(() => {
    throw new HttpError(404, "Claim not found");
  });
  return c;
}
async function ownAppraisal(projectId: string, appraisalId: string) {
  const a = await db.select().from(schema.appraisals).where(eq(schema.appraisals.id, appraisalId)).get();
  if (!a) throw new HttpError(404, "Appraisal not found");
  await ownPaper(projectId, a.paperId).catch(() => {
    throw new HttpError(404, "Appraisal not found");
  });
  return a;
}
async function ownQuestion(projectId: string, questionId: string) {
  const q = await db.select().from(schema.researchQuestions).where(and(eq(schema.researchQuestions.id, questionId), eq(schema.researchQuestions.projectId, projectId))).get();
  if (!q) throw new HttpError(404, "Question not found");
  return q;
}

// ---------- stages ----------
const JOB_STAGES: Record<number, string> = Object.fromEntries(STAGES.filter((s) => s.job).map((s) => [s.n, s.job!]));

async function requireUpstreamApproved(projectId: string, n: number) {
  const p = (await getProject(projectId));
  for (let i = 1; i < n; i++) {
    if (p.stageStates[String(i)] !== "approved") throw new HttpError(409, `Approve stage ${i} (${STAGES[i - 1].title}) first.`);
  }
}

on("POST", "stages/:n/approve", async ({ projectId, params }) => {
  const n = Number(params.n);
  (await requireUpstreamApproved(projectId, n));
  const p = (await getProject(projectId));
  const state = p.stageStates[String(n)];
  if (state === "running") throw new HttpError(409, "This stage is still running.");
  if (n === 1 && !p.idea.trim()) throw new HttpError(400, "Write your idea first.");
  if (n === 2) (await approveTopics(projectId));
  if (n === 3 && !(await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all()).length) throw new HttpError(400, "Build the queries first.");
  if (n === 9) {
    const chosen = (await db.select().from(schema.researchQuestions).where(and(eq(schema.researchQuestions.projectId, projectId), eq(schema.researchQuestions.chosen, true))).get());
    if (!chosen) throw new HttpError(400, "Pick one research question first.");
  }
  if (JOB_STAGES[n] && (state === "not_started" || state === "failed")) throw new HttpError(409, "Run this stage before approving it.");
  (await setStageState(projectId, n, "approved", { currentStage: Math.min(9, n + 1) }));
  (await logDecision(projectId, n, "stage_approved"));
  // Kick off the next stage's background job if it has never run.
  const next = n + 1;
  if (JOB_STAGES[next] && (await getProject(projectId)).stageStates[String(next)] === "not_started") {
    (await startJob(projectId, JOB_STAGES[next], next));
  }
  if (n === 9) (await db.update(schema.projects).set({ status: "complete", updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run());
  return (await projectView(projectId));
});

on("POST", "stages/:n/run", async ({ projectId, params, body }) => {
  const n = Number(params.n);
  (await requireUpstreamApproved(projectId, n));
  if (!JOB_STAGES[n]) throw new HttpError(400, "This stage has no background job.");
  const jobId = (await startJob(projectId, JOB_STAGES[n], n, (body as Record<string, unknown>) ?? {}));
  (await logDecision(projectId, n, "stage_run_requested", null, body));
  return { jobId };
});

on("POST", "stages/:n/cancel", async ({ projectId, params }) => {
  const n = Number(params.n);
  const j = (await db.select().from(schema.jobs).where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, n))).all()).filter((x) => x.status === "running" || x.status === "queued" || x.status === "paused");
  await forEachSeq(j, async (x) => (await cancelJob(x.id)));
  (await setStageState(projectId, n, "failed"));
  (await logDecision(projectId, n, "stage_cancelled"));
  return { cancelled: j.length };
});

/** Keep stale results: the stage returns to "needs review" so the user re-checks and approves it. */
on("POST", "stages/:n/keep", async ({ projectId, params }) => {
  const n = Number(params.n);
  const p = (await getProject(projectId));
  if (p.stageStates[String(n)] !== "stale") throw new HttpError(409, "Stage is not stale.");
  (await setStageState(projectId, n, "needs_review"));
  (await logDecision(projectId, n, "stale_results_kept", p.staleReasons[String(n)] ?? null));
  return (await projectView(projectId));
});

/** User is about to edit an approved stage: reopen it (and warn the UI about downstream). */
on("POST", "stages/:n/reopen", async ({ projectId, params }) => {
  const n = Number(params.n);
  const p = (await getProject(projectId));
  if (p.stageStates[String(n)] === "approved") (await setStageState(projectId, n, "needs_review", { currentStage: n }));
  (await logDecision(projectId, n, "stage_reopened_for_edit"));
  return (await projectView(projectId));
});

// ---------- stage 1 ----------
on("PATCH", "idea", async ({ projectId, body }) => {
  const { idea } = parse(z.object({ idea: z.string().trim().min(10, "Please write at least a sentence.").max(4000) }), body);
  const p = (await getProject(projectId));
  if (p.idea === idea) return (await projectView(projectId));
  (await db.update(schema.projects).set({ idea, title: idea.slice(0, 90), updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run());
  (await logDecision(projectId, 1, "idea_edited", p.idea, idea));
  (await markDownstreamStale(projectId, 1, "The research idea was edited"));
  return (await projectView(projectId));
});

// ---------- stage 2 ----------
on("GET", "scoping", async ({ projectId }) => (await scopingState(projectId)));
on("POST", "scoping/start", async ({ projectId }) => {
  const s = (await scopingState(projectId));
  if (s.messages.length) return s;
  return (await nextScopingTurn(projectId));
});
on("POST", "scoping/restart", async ({ projectId }) => {
  (await db.delete(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).run());
  (await logDecision(projectId, 2, "scoping_restarted"));
  (await setStageState(projectId, 2, "needs_review"));
  return (await nextScopingTurn(projectId));
});
on("POST", "scoping/answer", async ({ projectId, body }) => {
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), body);
  return (await answerScoping(projectId, text));
});
on("POST", "scoping/skip", async ({ projectId }) => (await skipScoping(projectId)));
on("POST", "scoping/topics", async ({ projectId }) => (await generateTopics(projectId)));

const TopicPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), synonyms: z.array(z.string().max(120)).max(30).optional(), controlledTerms: z.array(z.string().max(120)).max(20).optional(), rationale: z.string().max(400).optional() });
on("POST", "topics", async ({ projectId, body }) => ({ id: (await addTopic(projectId, parse(TopicPatch.extend({ name: z.string().trim().min(1).max(120) }), body))), state: (await scopingState(projectId)) }));
on("PATCH", "topics/:tid", async ({ projectId, params, body }) => {
  (await updateTopic(projectId, params.tid, parse(TopicPatch, body)));
  return (await scopingState(projectId));
});
on("DELETE", "topics/:tid", async ({ projectId, params }) => {
  (await deleteTopic(projectId, params.tid));
  return (await scopingState(projectId));
});
on("POST", "topics/merge", async ({ projectId, body }) => {
  const { ids, name } = parse(z.object({ ids: z.array(z.string()).min(2), name: z.string().trim().min(1).max(120) }), body);
  (await mergeTopics(projectId, ids, name));
  return (await scopingState(projectId));
});

// ---------- stage 3 ----------
on("GET", "search", async ({ projectId }) => (await searchState(projectId)));
on("POST", "search/build", async ({ projectId }) => (await buildQueries(projectId)));
on("PATCH", "queries/:qid", async ({ projectId, params, body }) => {
  const { queryString } = parse(z.object({ queryString: z.string().trim().min(2).max(4000) }), body);
  (await updateQuery(projectId, params.qid, queryString));
  return (await searchState(projectId));
});
on("POST", "queries/:qid/dryrun", async ({ projectId, params }) => (await dryRun(projectId, params.qid)));
on("POST", "search/dryrun-all", async ({ projectId }) => ({ results: await dryRunAll(projectId), state: (await searchState(projectId)) }));
const CriteriaSchema = z.object({
  yearFrom: z.number().int().min(1900).max(2100).nullable(),
  yearTo: z.number().int().min(1900).max(2100).nullable(),
  languages: z.array(z.string().trim().min(1).max(20)).max(10),
  studyTypes: z.array(z.string().trim().min(1).max(80)).max(20),
  inclusion: z.array(z.string().trim().min(1).max(300)).max(20),
  exclusion: z.array(z.string().trim().min(1).max(300)).max(20),
  hardFilter: z.array(z.enum(["journal_article", "review", "preprint"])).max(3).optional(),
});
on("PUT", "criteria", async ({ projectId, body }) => {
  (await updateCriteria(projectId, parse(CriteriaSchema, body)));
  return (await searchState(projectId));
});

// ---------- stage 4 ----------
on("GET", "retrieval", async ({ projectId }) => (await retrievalView(projectId)));

// ---------- stage 5 ----------
on("GET", "papers", async ({ projectId }) => (await papersTableView(projectId)));
on("GET", "papers-points", async ({ projectId }) => (await paperPointsView(projectId)));
on("GET", "papers/:pid", async ({ projectId, params }) => {
  const d = (await paperDetail(projectId, params.pid));
  if (!d) throw new HttpError(404, "Paper not found");
  return d;
});
on("PATCH", "papers/:pid/summary", async ({ projectId, params, body }) => {
  const patch = parse(z.object({ studyType: z.enum(STUDY_TYPES).optional(), setting: z.string().trim().min(1).max(300).optional(), keyFinding: z.string().trim().min(1).max(500).optional() }), body);
  await ownPaper(projectId, params.pid);
  const s = (await db.select().from(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, params.pid)).get());
  if (!s) throw new HttpError(404, "Summary not found");
  (await db.update(schema.paperSummaries).set({ ...patch, edited: true }).where(eq(schema.paperSummaries.id, s.id)).run());
  (await logDecision(projectId, 5, "summary_cell_edited", { studyType: s.studyType, setting: s.setting, keyFinding: s.keyFinding }, patch));
  (await markDownstreamStale(projectId, 5, "A summary-table cell was corrected"));
  return { ok: true };
});

// ---------- stage 6 ----------
on("GET", "ranking", async ({ projectId }) => (await rankingTableView(projectId)));
on("GET", "ranking/scores/:sid", async ({ projectId, params }) => {
  const s = await ownScore(projectId, params.sid);
  return { subScores: s.subScores, rationales: s.rationales };
});
on("POST", "ranking/select", async ({ projectId, body }) => {
  const { scoreId, selected } = parse(z.object({ scoreId: z.string(), selected: z.boolean() }), body);
  const s = await ownScore(projectId, scoreId);
  (await db.update(schema.scores).set({ selected, userChanged: true }).where(eq(schema.scores.id, scoreId)).run());
  (await logDecision(projectId, 6, selected ? "paper_selected" : "paper_deselected", { paperId: s.paperId, topicId: s.topicId, selected: s.selected }, { selected }));
  (await markDownstreamStale(projectId, 6, "The selected papers changed"));
  return (await rankingTableView(projectId));
});
on("POST", "ranking/swap", async ({ projectId, body }) => {
  const { outId, inId } = parse(z.object({ outId: z.string(), inId: z.string() }), body);
  const a = await ownScore(projectId, outId);
  const b = await ownScore(projectId, inId);
  if (a.topicId !== b.topicId) throw new HttpError(400, "Both papers must be in the same topic.");
  (await db.update(schema.scores).set({ selected: false, userChanged: true }).where(eq(schema.scores.id, outId)).run());
  (await db.update(schema.scores).set({ selected: true, userChanged: true }).where(eq(schema.scores.id, inId)).run());
  (await logDecision(projectId, 6, "papers_swapped", { out: a.paperId }, { in: b.paperId, topicId: a.topicId }));
  (await markDownstreamStale(projectId, 6, "The selected papers changed"));
  return (await rankingTableView(projectId));
});

// ---------- stage 7 ----------
on("GET", "appraisals", async ({ projectId }) => (await appraisalsView(projectId)));
on("GET", "appraisals/:aid", async ({ projectId, params }) => {
  const d = (await appraisalDetail(projectId, params.aid));
  if (!d) throw new HttpError(404, "Appraisal not found");
  return d;
});
on("PATCH", "claims/:cid", async ({ projectId, params, body }) => {
  const patch = parse(z.object({ decision: z.enum(["accept", "reject", "clear"]).optional(), statement: z.string().trim().min(1).max(600).optional() }), body);
  const c = await ownClaim(projectId, params.cid);
  const set: Partial<typeof schema.claims.$inferInsert> = {};
  if (patch.decision === "accept") Object.assign(set, { userAccepted: true, userRejected: false });
  if (patch.decision === "reject") Object.assign(set, { userAccepted: false, userRejected: true });
  if (patch.decision === "clear") Object.assign(set, { userAccepted: false, userRejected: false });
  if (patch.statement) set.statement = patch.statement;
  (await db.update(schema.claims).set(set).where(eq(schema.claims.id, c.id)).run());
  (await logDecision(projectId, 7, `claim_${patch.decision ?? "edited"}`, { verified: c.verified, accepted: c.userAccepted, rejected: c.userRejected, statement: c.statement }, set));
  (await markDownstreamStale(projectId, 7, "An appraisal claim was accepted, rejected or edited"));
  return (await appraisalDetail(projectId, c.appraisalId));
});
on("POST", "appraisals/reverify", async ({ projectId }) => {
  const r = (await reverifyProject(projectId));
  (await logDecision(projectId, 7, "quotes_reverified", null, r, "system"));
  if (r.changed) (await markDownstreamStale(projectId, 7, `Quote re-check changed ${r.changed} claim(s)`));
  return r;
});
on("POST", "appraisals/:aid/redo", async ({ projectId, params }) => {
  const a = await ownAppraisal(projectId, params.aid);
  return { jobId: (await startJob(projectId, "appraisal", 7, { paperIds: [a.paperId] })) };
});

// ---------- stage 8 ----------
on("GET", "synthesis", async ({ projectId }) => (await synthesisView(projectId)));
on("PATCH", "synthesis/:sid", async ({ projectId, params, body }) => {
  const { statement } = parse(z.object({ statement: z.string().trim().min(1).max(600) }), body);
  const s = await db.select().from(schema.synthesisItems).where(and(eq(schema.synthesisItems.id, params.sid), eq(schema.synthesisItems.projectId, projectId))).get();
  if (!s) throw new HttpError(404, "Not found");
  (await db.update(schema.synthesisItems).set({ statement, edited: true }).where(eq(schema.synthesisItems.id, s.id)).run());
  (await logDecision(projectId, 8, "synthesis_edited", s.statement, statement));
  (await markDownstreamStale(projectId, 8, "A synthesis statement was edited"));
  return (await synthesisView(projectId));
});

// ---------- stage 9 ----------
on("GET", "questions", async ({ projectId }) => (await questionsView(projectId)));
on("PATCH", "questions/:qid", async ({ projectId, params, body }) => {
  const patch = parse(z.object({ text: z.string().trim().min(5).max(600).optional(), structure: z.record(z.string(), z.string().max(400)).optional(), design: z.string().max(300).optional(), feasibility: z.string().max(800).optional(), weakness: z.string().max(600).optional() }), body);
  const q = await ownQuestion(projectId, params.qid);
  (await db.update(schema.researchQuestions).set({ ...patch, edited: true }).where(eq(schema.researchQuestions.id, q.id)).run());
  (await logDecision(projectId, 9, "question_edited", { text: q.text, structure: q.structure }, patch));
  if ((await getProject(projectId)).stageStates["9"] === "approved") (await setStageState(projectId, 9, "needs_review"));
  return (await questionsView(projectId));
});
on("POST", "questions/:qid/choose", async ({ projectId, params }) => {
  await ownQuestion(projectId, params.qid);
  (await db.update(schema.researchQuestions).set({ chosen: false }).where(eq(schema.researchQuestions.projectId, projectId)).run());
  (await db.update(schema.researchQuestions).set({ chosen: true }).where(eq(schema.researchQuestions.id, params.qid)).run());
  (await logDecision(projectId, 9, "question_chosen", null, { id: params.qid }));
  return (await questionsView(projectId));
});
on("POST", "questions/:qid/novelty", async ({ projectId, params }) => {
  await ownQuestion(projectId, params.qid);
  const reviewed = new Set((await db.select({ t: schema.papers.normTitle }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all()).map((r) => r.t));
  await runNovelty(params.qid, reviewed, () => {});
  return (await questionsView(projectId));
});

// ---------- view choices (category filters, grouping, colour) ----------
const Keys = z.array(z.string().max(80)).max(40);
const ViewPrefsSchema = z.object({
  colorBy: z.enum(["study", "topic", "source", "evidence", "score"]).optional(),
  filters: z.object({ study: Keys, article: Keys, topic: Keys, source: Keys, period: Keys, access: Keys, selected: Keys, evidence: Keys }).partial().optional(),
  groupBy: z.enum(["study", "article", "topic", "source", "period", "access", "selected", "evidence"]).nullable().optional(),
});
/** Saved per project and listed in the report. A view choice: it never hides data from later steps or marks anything stale. */
on("PUT", "view", async ({ projectId, body }) => {
  const prefs = parse(ViewPrefsSchema, body);
  const p = await getProject(projectId);
  if (JSON.stringify(p.viewPrefs ?? null) === JSON.stringify(prefs)) return { viewPrefs: prefs };
  await db.update(schema.projects).set({ viewPrefs: prefs }).where(eq(schema.projects.id, projectId)).run();
  await logDecision(projectId, p.currentStage, "view_choices_changed", p.viewPrefs ?? null, prefs);
  return { viewPrefs: prefs };
});

// ---------- canvas ----------
on("GET", "canvas", async ({ projectId }) => (await canvasView(projectId)));
on("GET", "claims", async ({ projectId }) => (await claimsView(projectId)));

// ---------- misc ----------
on("GET", "log", async ({ projectId }) => (await decisionLogView(projectId)));
export const PREVIEW_LINES = 200;
const EXPORTS: Record<string, { make: (projectId: string) => Promise<string>; type: string; ext: string }> = {
  markdown: { make: markdownReport, type: "text/markdown", ext: "md" },
  csv: { make: summaryCsv, type: "text/csv", ext: "csv" },
  bibtex: { make: selectedBibtex, type: "application/x-bibtex", ext: "bib" },
};

/** ?preview=1 is the in-app preview, not an export: the first lines as JSON, not logged. */
export async function exportPreview(projectId: string, kind: string) {
  const e = EXPORTS[kind];
  if (!e) throw new HttpError(404, "Unknown export");
  const lines = (await e.make(projectId)).split("\n");
  return { text: lines.slice(0, PREVIEW_LINES).join("\n"), lines: lines.length };
}

on("GET", "export/:kind", async ({ projectId, params, url }) => {
  if (url.searchParams.has("preview")) return exportPreview(projectId, params.kind);
  const e = EXPORTS[params.kind];
  if (!e) throw new HttpError(404, "Unknown export");
  const p = (await getProject(projectId));
  const slug = (p.title || "review").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  (await logDecision(projectId, 9, "exported", null, { kind: params.kind }, "user"));
  return new Response(await e.make(projectId), { headers: { "Content-Type": `${e.type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${slug}.${e.ext}"` } });
});
