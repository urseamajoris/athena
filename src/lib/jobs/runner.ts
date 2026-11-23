import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { newId, nowIso, errMsg } from "../util";
import { getProject, setStageState, logDecision, markDownstreamStale } from "../project";
import { STAGES } from "../shared/stages";
import { AiPausedError, AiUnavailableError, BudgetError } from "../ai/client";
import { NO_KEY_MESSAGE } from "../ai/errors";

/**
 * In-process job runner. Job state lives in SQLite (jobs table), so a page refresh or a client
 * disconnect never loses a running job; the browser reads progress over SSE from the same table.
 * On server start, jobs left "running" by a crashed process are re-queued and run again
 * (HTTP responses are cached, so re-running is cheap and deterministic).
 *
 * A job whose AI call is refused because AI was switched off, no xAI key is configured or the budget is spent is
 * *paused*, not failed: its stage stays "running", the work done so far is kept, and it resumes (re-runs, skipping
 * finished work) when an admin turns AI back on, adds a key or raises the budget, or when the user presses Resume.
 */

export interface JobContext {
  jobId: string;
  projectId: string;
  params: Record<string, unknown>;
  progress(done: number, total: number, message: string): Promise<void>;
  log(line: string): Promise<void>;
  cancelled(): Promise<boolean>;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

const g = globalThis as unknown as { __jobHandlers?: Map<string, JobHandler>; __jobActive?: Set<string>; __jobResumed?: boolean };
const handlers = (g.__jobHandlers ??= new Map());
const active = (g.__jobActive ??= new Set());

export function registerJob(kind: string, h: JobHandler) {
  handlers.set(kind, h);
}

/**
 * Queue a stage's job. Every later stage that already has output is marked stale first, before the microtask
 * that runs the handler can delete or replace rows they were built from. A paused job is resumed instead, and
 * is not marked stale again.
 */
export async function startJob(projectId: string, kind: string, stage: number, params: Record<string, unknown> = {}, reason?: string): Promise<string> {
  const running = (await db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, stage), inArray(schema.jobs.status, ["queued", "running", "paused"])))
      .get());
  if (running?.status === "paused") return resumeJob(running.id);
  if (running) return running.id;
  const def = STAGES[stage - 1];
  await markDownstreamStale(projectId, stage, reason ?? `Step ${stage} (${def?.title ?? kind}) was re-run`);
  const id = newId("job");
  (await db.insert(schema.jobs).values({ id, projectId, kind, stage, params, status: "queued" }).run());
  (await setStageState(projectId, stage, "running"));
  (await logDecision(projectId, stage, "job_started", null, { kind, params }, "system"));
  queueMicrotask(async () => void (await execute(id)));
  return id;
}

async function update(id: string, set: Partial<typeof schema.jobs.$inferInsert>) {
  (await db.update(schema.jobs).set({ ...set, heartbeatAt: nowIso() }).where(eq(schema.jobs.id, id)).run());
}

async function execute(id: string) {
  if (active.has(id)) return;
  const job = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get());
  if (!job || job.status === "cancelled") return;
  const handler = handlers.get(job.kind);
  if (!handler) {
    (await update(id, { status: "failed", error: `No handler for job kind ${job.kind}`, endedAt: nowIso() }));
    (await setStageState(job.projectId, job.stage, "failed"));
    return;
  }
  active.add(id);
  (await update(id, { status: "running", startedAt: job.startedAt ?? nowIso(), error: null }));
  const logLines: string[] = [...(job.log ?? [])];
  let lastFlush = 0;
  const flush = async (force = false) => {
    if (!force && Date.now() - lastFlush < 400) return;
    lastFlush = Date.now();
    (await update(id, { log: logLines.slice(-400) }));
  };
  const ctx: JobContext = {
    jobId: id,
    projectId: job.projectId,
    params: job.params,
    async progress(done, total, message) {
      (await update(id, { progress: { done, total, message } }));
    },
    async log(line) {
      logLines.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
      (await flush());
    },
    async cancelled() {
      const j = (await db.select({ s: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, id)).get());
      return j?.s === "cancelled";
    },
  };
  // cancelStage sets the stage itself. A stage marked stale while the job ran (an upstream edit) stays stale.
  const stillRunning = async () => (await getProject(job.projectId)).stageStates[String(job.stage)] === "running";
  try {
    await handler(ctx);
    (await flush(true));
    if (!(await ctx.cancelled())) {
      (await update(id, { status: "done", endedAt: nowIso() }));
      if (await stillRunning()) (await setStageState(job.projectId, job.stage, "needs_review"));
      (await logDecision(job.projectId, job.stage, "job_finished", null, { kind: job.kind }, "system"));
    }
  } catch (e) {
    if (e instanceof AiPausedError || e instanceof BudgetError) {
      const reason = e instanceof AiUnavailableError ? "no_key" : e instanceof AiPausedError ? "ai_off" : "budget";
      logLines.push(`PAUSED ${e.message}`);
      (await flush(true));
      (await update(id, { status: "paused", error: e.message }));
      (await logDecision(job.projectId, job.stage, "job_paused", null, { kind: job.kind, reason }, "system"));
      return;
    }
    logLines.push(`ERROR ${errMsg(e)}`);
    (await flush(true));
    if (!(await ctx.cancelled())) {
      (await update(id, { status: "failed", error: errMsg(e), endedAt: nowIso() }));
      if (await stillRunning()) (await setStageState(job.projectId, job.stage, "failed"));
      (await logDecision(job.projectId, job.stage, "job_failed", null, { kind: job.kind, error: errMsg(e) }, "system"));
    }
    console.error(`[athena] job ${job.kind} ${id} failed:`, e);
  } finally {
    active.delete(id);
  }
}

export async function cancelJob(id: string) {
  (await update(id, { status: "cancelled", endedAt: nowIso() }));
}

/**
 * Cancel a stage's queued, running, or paused job. If an earlier run of this stage finished, its results are what
 * the researcher has: untouched when the cancelled job never started ("needs review"), possibly half-replaced
 * when it had started ("stale"). Only a stage with no finished run becomes "failed".
 */
export async function cancelStage(projectId: string, stage: number): Promise<number> {
  const live = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, stage), inArray(schema.jobs.status, ["queued", "running", "paused"])))
    .all();
  if (!live.length) return 0;
  for (const j of live) await cancelJob(j.id);
  const finished = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, stage), eq(schema.jobs.status, "done"))).get();
  const started = live.some((j) => j.status === "running" || j.status === "paused" || j.startedAt);
  if (!finished) await setStageState(projectId, stage, "failed");
  else if (!started) await setStageState(projectId, stage, "needs_review");
  else await setStageState(projectId, stage, "stale", { reason: "A re-run of this step was cancelled before it finished, so these results may be partial or mix the earlier run with the new one." });
  await logDecision(projectId, stage, "stage_cancelled", null, { jobs: live.map((j) => j.id), previousRunFinished: !!finished, started }, "user");
  return live.length;
}

/** Resume jobs interrupted by a server restart. Called once from instrumentation. */
export async function resumeJobs() {
  if (g.__jobResumed) return;
  g.__jobResumed = true;
  const stuck = (await db.select().from(schema.jobs).where(inArray(schema.jobs.status, ["queued", "running"])).all());
  for (const j of stuck) {
    if (active.has(j.id)) continue;
    console.log(`[athena] resuming job ${j.kind} ${j.id}`);
    (await db.update(schema.jobs).set({ resumeCount: j.resumeCount + 1 }).where(eq(schema.jobs.id, j.id)).run());
    queueMicrotask(async () => void (await execute(j.id)));
  }
}

/** Picks a paused job up again. Its handler re-runs and skips the work it already finished. */
export async function resumeJob(id: string): Promise<string> {
  const j = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get());
  if (!j || j.status !== "paused") return id;
  (await db.update(schema.jobs).set({ status: "queued", error: null, params: { ...j.params, resumed: true } }).where(eq(schema.jobs.id, id)).run());
  (await logDecision(j.projectId, j.stage, "job_resumed", null, { kind: j.kind }, "system"));
  queueMicrotask(async () => void (await execute(id)));
  return id;
}

/** Every paused job (after an admin turns AI back on, adds a key or raises the budget). */
/** Startup: jobs paused only because no key was set resume once one is (e.g. XAI_API_KEY added and redeployed). */
export async function resumeJobsPausedForNoKey(): Promise<number> {
  const paused = (await db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.status, "paused"), eq(schema.jobs.error, NO_KEY_MESSAGE))).all());
  for (const j of paused) await resumeJob(j.id);
  return paused.length;
}

export async function resumePausedJobs(): Promise<number> {
  const paused = (await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.status, "paused")).all());
  for (const j of paused) await resumeJob(j.id);
  return paused.length;
}
