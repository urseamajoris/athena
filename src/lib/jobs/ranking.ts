import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { RubricScores } from "../db/schema";
import { structuredCall, unknownIds, BudgetError } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { RankingBatch, TopicImportance } from "../stages/ai-schemas";
import { chunk, errMsg, newId, forEachSeq } from "../util";
import { getProject, logDecision } from "../project";
import type { JobContext } from "./runner";
import { citationScore, recencyScore, weightedTotal } from "../scoring";

const BATCH = 10;
export const DEFAULT_SELECT = 4;
/** Max papers scored per topic (highest database relevance first) to bound cost. */
const MAX_PER_TOPIC = 60;

export async function rankingJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = (await getProject(projectId));
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
  const topicIds = topics.map((t) => t.id);
  (await db.delete(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).run());

  const links = (await db.select().from(schema.paperTopics).where(inArray(schema.paperTopics.topicId, topicIds.concat(["-"]))).all());
  const papers = (await db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all());
  const summaries = (await db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, papers.map((x) => x.id).concat(["-"]))).all());
  const hits = (await db.select().from(schema.paperHits).all());
  const bestRank = new Map<string, number>();
  for (const h of hits) bestRank.set(h.paperId, Math.min(bestRank.get(h.paperId) ?? 1e9, h.rank));
  const sum = new Map(summaries.map((s) => [s.paperId, s]));

  const jobs: { topic: (typeof topics)[number]; batch: typeof papers }[] = [];
  for (const t of topics) {
    const ps = links
      .filter((l) => l.topicId === t.id)
      .map((l) => papers.find((x) => x.id === l.paperId)!)
      .filter(Boolean)
      .sort((a, b) => (bestRank.get(a.id) ?? 0) - (bestRank.get(b.id) ?? 0))
      .slice(0, MAX_PER_TOPIC);
    if (links.filter((l) => l.topicId === t.id).length > MAX_PER_TOPIC) (await ctx.log(`Topic "${t.name}": scoring the ${MAX_PER_TOPIC} highest-relevance papers of ${links.filter((l) => l.topicId === t.id).length}.`));
    for (const b of chunk(ps, BATCH)) jobs.push({ topic: t, batch: b });
  }
  let finished = 0;
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
          vars: {
            idea: wrapData("research idea", p.idea),
            summary: wrapData("scoping summary", JSON.stringify(p.scopingSummary ?? {})),
            topic: `${topic.name} — ${topic.rationale}`,
            papers: batch
              .map((x) => {
                const s = sum.get(x.id);
                return wrapData(`paper ${x.id}`, `ID: ${x.id}\nTitle: ${x.title}\nYear: ${x.year ?? "n/a"}\nStudy type (from abstract): ${s?.studyType ?? "n/a"}\nSetting (from abstract): ${s?.setting ?? "n/a"}\nKey finding (from abstract): ${s?.keyFinding ?? "n/a"}\nAbstract excerpt: ${(x.abstract ?? "none").slice(0, 700)}`);
              })
              .join("\n\n"),
          },
          mockInput: { batch, summaries: batch.map((x) => sum.get(x.id) ?? null), topic },
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
        if (e instanceof BudgetError) throw e;
        (await ctx.log(`Scoring batch for "${topic.name}" failed: ${errMsg(e)}`));
      } finally {
        finished++;
        (await ctx.progress(finished, jobs.length + 1, `Scored ${finished}/${jobs.length} batches`));
      }
    }),
  );

  // Select top N per topic.
  const all = (await db.select().from(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).all());
  for (const t of topics) {
    const top = all.filter((s) => s.topicId === t.id).sort((a, b) => b.total - a.total).slice(0, DEFAULT_SELECT);
    for (const s of top) (await db.update(schema.scores).set({ selected: true }).where(eq(schema.scores.id, s.id)).run());
  }

  // Order topics by importance.
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
      mockInput: { topics },
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
    if (e instanceof BudgetError) throw e;
    (await ctx.log(`Topic ordering failed; keeping the original order: ${errMsg(e)}`));
    await forEachSeq(topics, async (t, i) => (await db.update(schema.topics).set({ importanceRank: i + 1, importanceJustification: "Original order (AI ordering failed)" }).where(eq(schema.topics.id, t.id)).run()));
  }
  (await logDecision(projectId, 6, "ranking_generated", null, { scored: all.length }, "ai"));
  if (!all.length) throw new Error("No papers could be scored.");
}
