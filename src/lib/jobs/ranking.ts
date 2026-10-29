import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { structuredCall, unknownIds, isAiStop } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { RankingBatch, TopicImportance } from "../stages/ai-schemas";
import { PER_TOPIC } from "../shared/stages";
import { chunk, errMsg, newId, forEachSeq } from "../util";
import { getProject, logDecision } from "../project";
import type { JobContext } from "./runner";
import { applyRankingRules, citationScore, defaultSelection, recencyScore } from "../scoring";
import { ideaSetting, rankedSetting } from "../shared/scope";

const BATCH = 10;
/** Max papers scored per topic (highest database relevance first) to bound cost. */
const MAX_PER_TOPIC = 60;

export async function rankingJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = (await getProject(projectId));
  const setting = ideaSetting(p.scopingSummary);
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
  const topicIds = topics.map((t) => t.id);
  const queries = (await db.select({ topicId: schema.queries.topicId, scope: schema.queries.scope }).from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  // A resumed job (after AI was paused) keeps the scores it already has and scores only the rest.
  const resumed = !!ctx.params.resumed;
  if (!resumed) (await db.delete(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).run());
  const scored = new Set(resumed ? (await db.select({ p: schema.scores.paperId, t: schema.scores.topicId }).from(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).all()).map((r) => `${r.t}:${r.p}`) : []);

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
    for (const b of chunk(ps.filter((x) => !scored.has(`${t.id}:${x.id}`)), BATCH)) jobs.push({ topic: t, batch: b });
  }
  let finished = 0;
  // The bar has one more step than the batches: ordering the topics at the end.
  const detail = () => ({ batches: { done: finished, total: jobs.length } });
  const message = `Scoring papers against ${topics.length === 1 ? "the topic" : `${topics.length} topics`}, ${BATCH} per batch`;
  (await ctx.progress(0, jobs.length + 1, message, detail()));
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
            setting: setting ? wrapData("setting", setting) : "none named (rate settingMatch for the population only)",
            topic: `${topic.name} — ${topic.rationale}`,
            papers: batch
              .map((x) => {
                const s = sum.get(x.id);
                return wrapData(`paper ${x.id}`, `ID: ${x.id}\nTitle: ${x.title}\nYear: ${x.year ?? "n/a"}\nStudy type (from abstract): ${s?.studyType ?? "n/a"}\nSetting (from abstract): ${s?.setting ?? "n/a"}\nKey finding (from abstract): ${s?.keyFinding ?? "n/a"}\nAbstract excerpt: ${(x.abstract ?? "none").slice(0, 700)}`);
              })
              .join("\n\n"),
          },
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
          // Off-setting papers and papers that only share words with the idea score low, and say why.
          const ruled = applyRankingRules(r, { recency: rec.score, citationImpact: cit.score }, rankedSetting(setting, queries.filter((q) => q.topicId === topic.id)));
          (await db.insert(schema.scores).values({
                        id: newId("sc"),
                        paperId: r.paperId,
                        topicId: topic.id,
                        subScores: ruled.sub,
                        rationales: { topicFit: ruled.topicFitWhy, designStrength: r.designStrengthWhy, settingMatch: ruled.settingMatchWhy, recency: rec.why, citationImpact: cit.why },
                        total: ruled.total,
                        rationale: ruled.overall,
                      }).onConflictDoNothing().run());
        }
      } catch (e) {
        if (isAiStop(e)) throw e;
        (await ctx.log(`Scoring batch for "${topic.name}" failed: ${errMsg(e)}`));
      } finally {
        finished++;
        (await ctx.progress(finished, jobs.length + 1, message, detail()));
      }
    }),
  );

  // Select the top papers per topic that match it (possibly fewer than the default, or none).
  const all = (await db.select().from(schema.scores).where(inArray(schema.scores.topicId, topicIds.concat(["-"]))).all());
  for (const t of topics) {
    const top = defaultSelection(all.filter((s) => s.topicId === t.id));
    for (const s of top) (await db.update(schema.scores).set({ selected: true }).where(eq(schema.scores.id, s.id)).run());
    if (top.length < PER_TOPIC.min) (await ctx.log(`Topic "${t.name}": ${top.length} paper${top.length === 1 ? "" : "s"} selected; papers that do not match the topic are not selected.`));
  }

  // Order topics by importance.
  (await ctx.progress(jobs.length, jobs.length + 1, "Ordering topics by importance", detail()));
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
  (await logDecision(projectId, 6, "ranking_generated", null, { scored: all.length }, "ai"));
  if (!all.length) throw new Error("No papers could be scored.");
  // The last report is what "Finished …" shows once the job is done.
  (await ctx.progress(jobs.length + 1, jobs.length + 1, `Scored ${new Set(all.map((s) => s.paperId)).size} papers against ${topics.length === 1 ? "the topic" : `${topics.length} topics`}`, detail()));
}
