import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { RubricScores } from "../db/schema";
import { structuredCall, unknownIds, BudgetError, repairId } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { RankingBatch, TopicImportance } from "../stages/ai-schemas";
import { chunk, errMsg, newId } from "../util";
import { getProject, logDecision } from "../project";
import type { JobContext } from "./runner";
import { citationScore, recencyScore, weightedTotal } from "../scoring";
import { detectCriteriaFlags } from "../shared/criteria";
import { buildRankingPromptVars, selectInitialRankingIds } from "../review-guards";

const BATCH = 10;
export const DEFAULT_SELECT = 4;
/** Max papers scored per topic (highest database relevance first) to bound cost. */
const MAX_PER_TOPIC = 60;

type Paper = typeof schema.papers.$inferSelect;
type Topic = typeof schema.topics.$inferSelect;

/**
 * The papers the ranking job scores for each topic: every paper linked to the topic, best database rank first,
 * capped at MAX_PER_TOPIC. Shared with the approval gate, which compares it with the scores actually stored.
 */
export function rankingCandidates(projectId: string): { topic: Topic; papers: Paper[]; linked: number }[] {
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all();
  const links = db.select().from(schema.paperTopics).where(inArray(schema.paperTopics.topicId, topics.map((t) => t.id).concat(["-"]))).all();
  const papers = db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const hits = db.select().from(schema.paperHits).where(inArray(schema.paperHits.paperId, papers.map((x) => x.id).concat(["-"]))).all();
  const bestRank = new Map<string, number>();
  for (const h of hits) bestRank.set(h.paperId, Math.min(bestRank.get(h.paperId) ?? 1e9, h.rank));
  const byId = new Map(papers.map((x) => [x.id, x]));
  return topics.map((topic) => {
    const linked = links.filter((l) => l.topicId === topic.id).map((l) => byId.get(l.paperId)!).filter(Boolean);
    return { topic, linked: linked.length, papers: linked.sort((a, b) => (bestRank.get(a.id) ?? 0) - (bestRank.get(b.id) ?? 0)).slice(0, MAX_PER_TOPIC) };
  });
}

/**
 * Score papers per topic. With `retryMissing`, only candidates that have no score yet (a batch failed) are scored:
 * existing scores and the researcher's selections are kept, and only topics with nothing selected get a default pick.
 */
export async function rankingJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = getProject(projectId);
  const retry = !!ctx.params.retryMissing;
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all();
  const topicIds = topics.map((t) => t.id);
  if (!retry) db.delete(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).run();
  const scored = new Set(db.select().from(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).all().map((s) => `${s.topicId}:${s.paperId}`));

  const papers = db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const summaries = db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, papers.map((x) => x.id).concat(["-"]))).all();
  const sum = new Map(summaries.map((s) => [s.paperId, s]));

  const jobs: { topic: (typeof topics)[number]; batch: typeof papers }[] = [];
  for (const { topic: t, papers: cands, linked } of rankingCandidates(projectId)) {
    if (linked > MAX_PER_TOPIC) ctx.log(`Topic "${t.name}": scoring the ${MAX_PER_TOPIC} highest-relevance papers of ${linked}.`);
    const ps = cands.filter((x) => !scored.has(`${t.id}:${x.id}`));
    for (const b of chunk(ps, BATCH)) jobs.push({ topic: t, batch: b });
  }
  let failedPapers = 0;
  let finished = 0;
  ctx.progress(0, jobs.length + 1, `Scoring ${jobs.length} batches across ${topics.length} topics`);
  await Promise.all(
    jobs.map(async ({ topic, batch }) => {
      if (ctx.cancelled()) return;
      const ids = batch.map((x) => x.id);
      try {
        const { data } = await structuredCall({
          prompt: "ranking",
          role: "fast",
          schema: RankingBatch,
          projectId,
          stage: 6,
          vars: buildRankingPromptVars({
            idea: p.idea,
            scopingSummary: p.scopingSummary,
            criteria: p.criteria,
            topic,
            batch,
            summaries: sum,
          }),
          mockInput: { batch, summaries: batch.map((x) => sum.get(x.id) ?? null), topic },
          normalize: (o) => ({ scores: o.scores.map((r) => ({ ...r, paperId: repairId(r.paperId, ids) })) }),
          check: (o) => {
            const bad = unknownIds(o.scores.map((r) => r.paperId), ids);
            if (bad.length) return `Unknown paperId(s): ${bad.join(", ")}`;
            const missing = ids.filter((id) => !o.scores.some((r) => r.paperId === id));
            return missing.length ? `Missing scores for: ${missing.join(", ")}` : null;
          },
        });
        for (const r of data.scores) {
          const paper = batch.find((x) => x.id === r.paperId)!;
          const rec = recencyScore(paper.year);
          const cit = citationScore(paper.citationCount, paper.year);
          const sub: RubricScores = { topicFit: r.topicFit, designStrength: r.designStrength, settingMatch: r.settingMatch, recency: rec.score, citationImpact: cit.score };
          db.insert(schema.scores).values({
            id: newId("sc"),
            paperId: r.paperId,
            topicId: topic.id,
            subScores: sub,
            rationales: { topicFit: r.topicFitWhy, designStrength: r.designStrengthWhy, settingMatch: r.settingMatchWhy, recency: rec.why, citationImpact: cit.why },
            total: weightedTotal(sub),
            rationale: r.overall,
          }).onConflictDoNothing().run();
        }
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        failedPapers += batch.length;
        ctx.log(`Scoring batch for "${topic.name}" failed (${batch.length} papers left unscored): ${errMsg(e)}`);
      } finally {
        finished++;
        ctx.progress(finished, jobs.length + 1, `Scored ${finished}/${jobs.length} batches`);
      }
    }),
  );

  // Select top N per topic. A retry leaves an existing selection alone. Flagged and excluded papers stay visible but are not auto-selected.
  const all = db.select().from(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).all();
  const paperFlagsById = new Map(
    papers.map((x) => [x.id, { flags: detectCriteriaFlags(x, sum.get(x.id), p.criteria), excluded: !!x.excluded }]),
  );
  for (const t of topics) {
    const ts = all.filter((s) => s.topicId === t.id);
    if (retry && ts.some((s) => s.selected)) continue;
    const topIds = selectInitialRankingIds(ts, paperFlagsById, DEFAULT_SELECT);
    for (const sid of topIds) db.update(schema.scores).set({ selected: true }).where(eq(schema.scores.id, sid)).run();
  }

  // Order topics by importance (a retry keeps the existing order).
  if (!(retry && topics.every((t) => t.importanceRank !== null))) {
    ctx.progress(jobs.length, jobs.length + 1, "Ordering topics by importance");
    try {
      const stats = topics.map((t) => {
        const ss = all.filter((s) => s.topicId === t.id);
        const mean = ss.length ? ss.reduce((a, s) => a + s.subScores.topicFit, 0) / ss.length : 0;
        return `${t.id} — ${t.name} — ${ss.length} — ${mean.toFixed(1)}`;
      });
      const { data } = await structuredCall({
        prompt: "topic_importance",
        role: "fast",
        schema: TopicImportance,
        projectId,
        stage: 6,
        vars: { idea: wrapData("research idea", p.idea), topics: wrapData("topics", stats.join("\n")) },
        mockInput: { topics },
        normalize: (o) => ({ order: o.order.map((x) => ({ ...x, topicId: repairId(x.topicId, topicIds) })) }),
        check: (o) => {
          const bad = unknownIds(o.order.map((x) => x.topicId), topicIds);
          if (bad.length) return `Unknown topicId(s): ${bad.join(", ")}`;
          const missing = topicIds.filter((id) => !o.order.some((x) => x.topicId === id));
          return missing.length ? `Missing topics: ${missing.join(", ")}` : null;
        },
      });
      const sorted = [...data.order].sort((a, b) => a.rank - b.rank);
      sorted.forEach((o, i) => db.update(schema.topics).set({ importanceRank: i + 1, importanceJustification: o.justification }).where(eq(schema.topics.id, o.topicId)).run());
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      ctx.log(`Topic ordering failed; keeping the original order: ${errMsg(e)}`);
      topics.forEach((t, i) => db.update(schema.topics).set({ importanceRank: i + 1, importanceJustification: "Original order (AI ordering failed)" }).where(eq(schema.topics.id, t.id)).run());
    }
  }
  logDecision(projectId, 6, retry ? "ranking_retried" : "ranking_generated", null, { scored: all.length, unscored: failedPapers }, "ai");
  if (failedPapers) ctx.log(`${failedPapers} papers could not be scored, so the ranking is partial. Use "Retry unscored papers" to score them.`);
  if (!all.length) throw new Error("No papers could be scored.");
}
