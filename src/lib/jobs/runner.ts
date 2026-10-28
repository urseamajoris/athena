import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { newId, nowIso, errMsg } from "../util";
import { setStageState, logDecision } from "../project";

/**
 * In-process job runner. Job state lives in SQLite (jobs table), so a page refresh or a client
 * disconnect never loses a running job; the browser reads progress over SSE from the same table.
 * On server start, jobs left "running" by a crashed process are re-queued and run again
 * (HTTP responses are cached, so re-running is cheap and deterministic).
 */

export interface JobContext {
  jobId: string;
  projectId: string;
  params: Record<string, unknown>;
  progress(done: number, total: number, message: string): void;
  log(line: string): void;
  cancelled(): boolean;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

const g = globalThis as unknown as { __jobHandlers?: Map<string, JobHandler>; __jobActive?: Set<string>; __jobResumed?: boolean };
const handlers = (g.__jobHandlers ??= new Map());
const active = (g.__jobActive ??= new Set());

export function registerJob(kind: string, h: JobHandler) {
  handlers.set(kind, h);
}

export function startJob(projectId: string, kind: string, stage: number, params: Record<string, unknown> = {}): string {
  const running = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, stage), inArray(schema.jobs.status, ["queued", "running"])))
    .get();
  if (running) return running.id;
  const id = newId("job");
  db.insert(schema.jobs).values({ id, projectId, kind, stage, params, status: "queued" }).run();
  setStageState(projectId, stage, "running");
  logDecision(projectId, stage, "job_started", null, { kind, params }, "system");
  queueMicrotask(() => void execute(id));
  return id;
}

function update(id: string, set: Partial<typeof schema.jobs.$inferInsert>) {
  db.update(schema.jobs).set({ ...set, heartbeatAt: nowIso() }).where(eq(schema.jobs.id, id)).run();
}

async function execute(id: string) {
  if (active.has(id)) return;
  const job = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
  if (!job) return;
  const handler = handlers.get(job.kind);
  if (!handler) {
    update(id, { status: "failed", error: `No handler for job kind ${job.kind}`, endedAt: nowIso() });
    setStageState(job.projectId, job.stage, "failed");
    return;
  }
  active.add(id);
  update(id, { status: "running", startedAt: job.startedAt ?? nowIso(), error: null });
  const logLines: string[] = [...(job.log ?? [])];
  let lastFlush = 0;
  const flush = (force = false) => {
    if (!force && Date.now() - lastFlush < 400) return;
    lastFlush = Date.now();
    update(id, { log: logLines.slice(-400) });
  };
  const ctx: JobContext = {
    jobId: id,
    projectId: job.projectId,
    params: job.params,
    progress(done, total, message) {
      update(id, { progress: { done, total, message } });
    },
    log(line) {
      logLines.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
      flush();
    },
    cancelled() {
      const j = db.select({ s: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, id)).get();
      return j?.s === "cancelled";
    },
  };
  try {
    await handler(ctx);
    flush(true);
    if (ctx.cancelled()) {
      setStageState(job.projectId, job.stage, "failed");
    } else {
      update(id, { status: "done", endedAt: nowIso() });
      setStageState(job.projectId, job.stage, "needs_review");
      logDecision(job.projectId, job.stage, "job_finished", null, { kind: job.kind }, "system");
    }
  } catch (e) {
    logLines.push(`ERROR ${errMsg(e)}`);
    flush(true);
    update(id, { status: "failed", error: errMsg(e), endedAt: nowIso() });
    setStageState(job.projectId, job.stage, "failed");
    logDecision(job.projectId, job.stage, "job_failed", null, { kind: job.kind, error: errMsg(e) }, "system");
    console.error(`[athena] job ${job.kind} ${id} failed:`, e);
  } finally {
    active.delete(id);
  }
}

export function cancelJob(id: string) {
  update(id, { status: "cancelled", endedAt: nowIso() });
}

/** Resume jobs interrupted by a server restart. Called once from instrumentation. */
export function resumeJobs() {
  if (g.__jobResumed) return;
  g.__jobResumed = true;
  const stuck = db.select().from(schema.jobs).where(inArray(schema.jobs.status, ["queued", "running"])).all();
  for (const j of stuck) {
    if (active.has(j.id)) continue;
    console.log(`[athena] resuming job ${j.kind} ${j.id}`);
    queueMicrotask(() => void execute(j.id));
  }
}
