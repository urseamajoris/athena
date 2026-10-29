import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { STAGES, type StageState } from "./shared/stages";
import { newId, nowIso } from "./util";

export function initialStageStates(): Record<string, StageState> {
  return Object.fromEntries(STAGES.map((s) => [String(s.n), s.n === 1 ? "needs_review" : "not_started"])) as Record<string, StageState>;
}

export async function getProject(id: string) {
  const p = (await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get());
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function logDecision(projectId: string, stage: number, action: string, before?: unknown, after?: unknown, actor: "user" | "ai" | "system" = "user") {
  (await db.insert(schema.decisionLog).values({ id: newId("log"), projectId, stage, actor, action, before: before ?? null, after: after ?? null }).run());
}

export async function setStageState(projectId: string, stage: number, state: StageState, extra?: { currentStage?: number }) {
  const p = (await getProject(projectId));
  const states = { ...p.stageStates, [String(stage)]: state };
  const reasons = { ...p.staleReasons };
  if (state !== "stale") delete reasons[String(stage)];
  (await db.update(schema.projects)
        .set({ stageStates: states, staleReasons: reasons, updatedAt: nowIso(), ...(extra?.currentStage ? { currentStage: extra.currentStage } : {}) })
        .where(eq(schema.projects.id, projectId))
        .run());
}

/**
 * Called whenever an upstream stage's outputs change. Every later stage that has produced anything
 * becomes "stale" so results never silently go out of date. Returns the stages marked.
 */
export async function markDownstreamStale(projectId: string, fromStage: number, reason: string): Promise<number[]> {
  const p = (await getProject(projectId));
  const states = { ...p.stageStates };
  const reasons = { ...p.staleReasons };
  const marked: number[] = [];
  for (const s of STAGES) {
    if (s.n <= fromStage) continue;
    const cur = states[String(s.n)];
    if (cur && cur !== "not_started" && cur !== "stale") {
      states[String(s.n)] = "stale";
      reasons[String(s.n)] = reason;
      marked.push(s.n);
    } else if (cur === "stale") {
      reasons[String(s.n)] = reasons[String(s.n)] || reason;
    }
  }
  // An edited upstream stage itself goes back to review.
  if (states[String(fromStage)] === "approved") states[String(fromStage)] = "needs_review";
  (await db.update(schema.projects).set({ stageStates: states, staleReasons: reasons, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run());
  if (marked.length) (await logDecision(projectId, fromStage, "downstream_marked_stale", null, { stages: marked, reason }, "system"));
  return marked;
}

export async function stageCosts(projectId: string) {
  const rows = (await db
      .select({
        stage: schema.aiCalls.stage,
        calls: sql<number>`count(*)`,
        input: sql<number>`coalesce(sum(${schema.aiCalls.inputTokens}),0)`,
        output: sql<number>`coalesce(sum(${schema.aiCalls.outputTokens}),0)`,
        cost: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)`,
        failures: sql<number>`sum(case when ${schema.aiCalls.status} != 'ok' then 1 else 0 end)`,
      })
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.projectId, projectId))
      .groupBy(schema.aiCalls.stage)
      .all());
  return Object.fromEntries(rows.map((r) => [String(r.stage), r]));
}

export async function latestJob(projectId: string, stage: number) {
  return (await db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, stage)))
      .orderBy(sql`${schema.jobs.createdAt} desc`)
      .limit(1)
      .get());
}
