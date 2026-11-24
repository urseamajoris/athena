import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { RubricScores } from "../db/schema";
import { structuredCall, unknownIds, isAiStop } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { RankingBatch, TopicImportance } from "../stages/ai-schemas";
import { detectCriteriaFlags } from "../shared/criteria";
import { PER_TOPIC } from "../shared/stages";
import { chunk, errMsg, newId, forEachSeq } from "../util";
import { getProject, logDecision } from "../project";
import { buildRankingPromptVars, selectInitialRankingIds, type RankingSummaryInput } from "../review-guards";
import { calculateReviewCredits } from "../shared/credits";
import { chargeCreditsForJob, ensureCreditsForStage } from "../credits";
import type { JobContext } from "./runner";
import { DEFAULT_SELECT, citationScore, recencyScore, weightedTotal } from "../scoring";

const BATCH = 10;
/** Max papers scored per topic (highest database relevance first) to bound cost. */
export const MAX_PER_TOPIC = 60;

type Paper = typeof schema.papers.$inferSelect;
type Topic = typeof schema.topics.$inferSelect;

export async function rankingCandidates(projectId: string): Promise<{ topic: Topic; papers: Paper[]; linked: number; beyondCap: Paper[] }[]> {
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
  const links = (await db.select().from(schema.paperTopics).where(inArray(schema.paperTopics.topicId, topics.map((t) => t.id).concat(["-"]))).all());
  const papers = (await db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all());
  const hits = (await db.select().from(schema.paperHits).where(inArray(schema.paperHits.paperId, papers.map((x) => x.id).concat(["-"]))).all());
  const bestRank = new Map<string, number>();
  for (const h of hits) bestRank.set(h.paperId, Math.min(bestRank.get(h.paperId) ?? 1e9, h.rank));
  const byId = new Map(papers.map((x) => [x.id, x]));
  return topics.map((topic) => {
    const linked = links.filter((l) => l.topicId === topic.id).map((l) => byId.get(l.paperId)!).filter(Boolean);
    linked.sort((a, b) => (bestRank.get(a.id) ?? 0) - (bestRank.get(b.id) ?? 0));
    return { topic, linked: linked.length, papers: linked.slice(0, MAX_PER_TOPIC), beyondCap: linked.slice(MAX_PER_TOPIC) };
  });
}

export async function rankingJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = (await getProject(projectId));
  const resumed = !!ctx.params.resumed;
  const retry = !!ctx.params.retryMissing;
  const candidates = (await rankingCandidates(projectId));
  const topics = candidates.map((c) => c.topic);
  const topicIds = topics.map((t) => t.id);
  // A resumed job (after AI was paused) or a retry of missing scores keeps the scores it already has.
  if (!resumed && !retry) (await db.delete(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).run());
  const scored = new Set((resumed || retry) ? (await db.select({ p: schema.scores.paperId, t: schema.scores.topicId }).from(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).all()).map((r) => `${r.t}:${r.p}`) : []);

  const byPaper = new Map<string, Paper>();
  for (const c of candidates) for (const paper of [...c.papers, ...c.beyondCap]) byPaper.set(paper.id, paper);
  const summaries = (await db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, [...byPaper.keys()].concat(["-"]))).all());
  const sum = new Map<string, RankingSummaryInput>(summaries.map((s) => [s.paperId, { studyType: s.studyType, setting: s.setting, keyFinding: s.keyFinding }]));

  const jobs: { topic: Topic; batch: Paper[] }[] = [];
  const papersToScore = new Map<string, Paper>();
  for (const { topic, papers, linked } of candidates) {
    if (linked > MAX_PER_TOPIC) (await ctx.log(`Topic "${topic.name}": scoring the ${MAX_PER_TOPIC} highest-relevance papers of ${linked}; ${linked - MAX_PER_TOPIC} are not scored (you will be asked to accept this before approving).`));
    const remaining = papers.filter((x) => !scored.has(`${topic.id}:${x.id}`));
    for (const rp of remaining) papersToScore.set(rp.id, rp);
    for (const b of chunk(remaining, BATCH)) jobs.push({ topic, batch: b });
  }
  const rankingQuote = calculateReviewCredits("ranking", [...papersToScore.values()]);
  await ensureCreditsForStage(projectId, "ranking", rankingQuote);
  let finished = 0;
  let unscored = 0;
  (await ctx.progress(0, jobs.length + 1, `Scoring ${jobs.length} batches across ${topics.length} topics`));
  await Promise.all(
    jobs.map(async ({ topic, batch }) => {
      if ((await ctx.cancelled())) return;
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
            scopingSummary: p.scopingSummary as Record<string, string> | null,
            criteria: p.criteria,
            topic,
            batch,
            summaries: sum,
          }),
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
          (await db.insert(schema.scores).values({
            id: newId("sc"),
            paperId: r.paperId,
            topicId: topic.id,
            subScores: sub,
            rationales: { topicFit: r.topicFitWhy, designStrength: r.designStrengthWhy, settingMatch: r.settingMatchWhy, recency: rec.why, citationImpact: cit.why },
            total: weightedTotal(sub),
            rationale: r.overall,
          }).onConflictDoNothing().run());
        }
      } catch (e) {
        if (isAiStop(e)) throw e;
        unscored += batch.length;
        (await ctx.log(`Scoring batch for "${topic.name}" failed: ${errMsg(e)}`));
      } finally {
        finished++;
        (await ctx.progress(finished, jobs.length + 1, `Scored ${finished}/${jobs.length} batches`));
      }
    }),
  );

  // Select the top papers per topic that match it (possibly fewer than the default, or none).
  const all = (await db.select().from(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).all());
  const paperFlagsById = new Map<string, { flags: ReturnType<typeof detectCriteriaFlags>; excluded: boolean }>();
  for (const paper of byPaper.values()) paperFlagsById.set(paper.id, { flags: detectCriteriaFlags(paper, sum.get(paper.id), p.criteria), excluded: !!paper.excluded });
  for (const t of topics) {
    const ts = all.filter((s) => s.topicId === t.id);
    if ((retry || resumed) && ts.some((s) => s.selected || s.userChanged)) continue;
    const picked = selectInitialRankingIds(ts.filter((s) => !s.userChanged), paperFlagsById, DEFAULT_SELECT);
    for (const id of picked) (await db.update(schema.scores).set({ selected: true }).where(eq(schema.scores.id, id)).run());
    if (picked.length < PER_TOPIC.min) (await ctx.log(`Topic "${t.name}": ${picked.length} paper${picked.length === 1 ? "" : "s"} selected; papers that do not match the topic are not selected.`));
  }

  // Order topics by importance. A retry or resume keeps an order that is already stored.
  if ((retry || resumed) && topics.every((t) => t.importanceRank !== null)) {
    (await ctx.progress(jobs.length + 1, jobs.length + 1, "Keeping the existing topic order"));
  } else {
    (await ctx.progress(jobs.length, jobs.length + 1, "Ordering topics by importance"));
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
        check: (o) => {
          const bad = unknownIds(o.order.map((x) => x.topicId), topicIds);
          if (bad.length) return `Unknown topicId(s): ${bad.join(", ")}`;
          const missing = topicIds.filter((id) => !o.order.some((x) => x.topicId === id));
          return missing.length ? `Missing topics: ${missing.join(", ")}` : null;
        },
      });
      const sorted = [...data.order].sort((a, b) => a.rank - b.rank);
      await forEachSeq(sorted, async (o, i) => (await db.update(schema.topics).set({ importanceRank: i + 1, importanceJustification: o.justification }).where(eq(schema.topics.id, o.topicId)).run()));
    } catch (e) {
      if (isAiStop(e)) throw e;
      (await ctx.log(`Topic ordering failed; keeping the original order: ${errMsg(e)}`));
      await forEachSeq(topics, async (t, i) => (await db.update(schema.topics).set({ importanceRank: i + 1, importanceJustification: "Original order (AI ordering failed)" }).where(eq(schema.topics.id, t.id)).run()));
    }
  }
  if (!all.length) throw new Error("No papers could be scored.");
  const charged = await chargeCreditsForJob({
    projectId,
    jobId: ctx.jobId,
    operation: "ranking",
    quote: rankingQuote,
    allowClampToZero: true,
  });
  if (charged.charged > 0) {
    await ctx.log(`Credits used for ranking: ${charged.charged} (${rankingQuote.articleCount} articles, ~${rankingQuote.approxTokens.toLocaleString("en-US")} tokens)`);
  }
  (await logDecision(projectId, 6, retry ? "ranking_retried" : "ranking_generated", null, { scored: all.length, unscored, creditsUsed: charged.charged, approxTokens: rankingQuote.approxTokens }, "ai"));
}
