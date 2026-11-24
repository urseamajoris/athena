import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite } from "../db";
import { structuredCall, unknownIds, AiValidationError, isAiStop } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { SummaryRows } from "../stages/ai-schemas";
import { chunk, errMsg } from "../util";
import { logDecision } from "../project";
import { calculateReviewCredits } from "../shared/credits";
import { chargeCreditsForJob, ensureCreditsForStage } from "../credits";
import type { JobContext } from "./runner";

const BATCH = 8;
const MAX_ABSTRACT = 2500;

type SummaryInsert = typeof schema.paperSummaries.$inferInsert;

/**
 * Summarise papers that have no row yet ("Retry missing summaries" and the first run): existing rows are never
 * touched. With `force` (the stage's Re-run control) every paper is summarised again, but the existing rows,
 * including cells the researcher corrected, stay in place until the new rows are ready: they are swapped in at
 * the end, only if the run was not cancelled and did not fail outright, and the corrected text they replace is
 * written to the decision log first. Papers whose batch failed keep the row they had.
 */
export async function summariesJob(ctx: JobContext) {
  const { projectId } = ctx;
  const papers = await db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const done = new Set(
    (await db.select({ id: schema.paperSummaries.paperId }).from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, papers.map((p) => p.id).concat(["-"]))).all()).map((r) => r.id),
  );
  const force = !!ctx.params.force;
  const staged: SummaryInsert[] = [];
  const put = async (row: SummaryInsert) => {
    if (force) staged.push(row);
    else await db.insert(schema.paperSummaries).values(row).onConflictDoNothing().run();
  };
  const todo = force ? papers : papers.filter((p) => !done.has(p.id));
  const summaryQuote = calculateReviewCredits("summaries", todo);
  await ensureCreditsForStage(projectId, "summaries", summaryQuote);
  // Papers with no abstract get "not reported" without a model call (nothing to summarise).
  const noAbs = todo.filter((p) => !p.abstract || p.abstract.length < 80);
  for (const p of noAbs) {
    await put({ id: `s_${p.id}`, paperId: p.id, studyType: "not_reported", setting: "not reported (no abstract available)", keyFinding: "not reported (no abstract available)", abstractDerived: true, model: null, promptVersion: null });
  }
  const withAbs = todo.filter((p) => !noAbs.includes(p));
  const batches = chunk(withAbs, BATCH);
  let finished = 0;
  let failed = 0;
  await ctx.progress(0, batches.length, `Summarising ${withAbs.length} abstracts (${noAbs.length} without abstract)`);
  await Promise.all(
    batches.map(async (batch) => {
      if (await ctx.cancelled()) return;
      const ids = batch.map((p) => p.id);
      try {
        const { data, model, promptVersion } = await structuredCall({
          prompt: "paper_summary",
          role: "summary",
          schema: SummaryRows,
          projectId,
          stage: 5,
          vars: {
            papers: batch
              .map((p) => wrapData(`paper ${p.id}`, `ID: ${p.id}\nTitle: ${p.title}\nPublication types: ${p.publicationTypes.join(", ") || "n/a"}\nAbstract: ${(p.abstract ?? "").slice(0, MAX_ABSTRACT)}`))
              .join("\n\n"),
          },
          check: (o) => {
            const bad = unknownIds(o.rows.map((r) => r.paperId), ids);
            if (bad.length) return `Unknown paperId(s): ${bad.join(", ")}`;
            const missing = ids.filter((id) => !o.rows.some((r) => r.paperId === id));
            return missing.length ? `Missing rows for: ${missing.join(", ")}` : null;
          },
        });
        for (const r of data.rows) {
          await put({ id: `s_${r.paperId}`, paperId: r.paperId, studyType: r.studyType, setting: r.setting, keyFinding: r.keyFinding, abstractDerived: true, model, promptVersion });
        }
      } catch (e) {
        if (isAiStop(e)) throw e;
        failed += batch.length;
        await ctx.log(`Batch failed (${e instanceof AiValidationError ? "validation" : "error"}): ${errMsg(e)}`);
      } finally {
        finished++;
        await ctx.progress(finished, batches.length, `Summarised ${finished}/${batches.length} batches`);
      }
    }),
  );
  const allFailed = failed > 0 && failed === withAbs.length;
  if (force) {
    // Cancelled or failed outright: the rows the researcher had (and corrected) are still there.
    if (await ctx.cancelled()) return;
    if (allFailed) throw new Error("All summary batches failed. The previous summaries, including your corrections, were kept.");
    const pids = staged.map((r) => r.paperId).concat(["-"]);
    const previous = await db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, pids)).all();
    const corrected = previous.filter((s) => s.edited);
    if (corrected.length) {
      await logDecision(
        projectId,
        5,
        "summaries_replaced",
        corrected.map((s) => ({ paperId: s.paperId, studyType: s.studyType, setting: s.setting, keyFinding: s.keyFinding })),
        { replaced: previous.length, corrected: corrected.length, jobId: ctx.jobId },
        "system",
      );
    }
    await batchWrite([
      db.delete(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, pids)),
      ...staged.map((r) => db.insert(schema.paperSummaries).values(r)),
    ]);
  }
  if (allFailed) throw new Error("All summary batches failed.");
  const charged = await chargeCreditsForJob({
    projectId,
    jobId: ctx.jobId,
    operation: "summaries",
    quote: summaryQuote,
    allowClampToZero: true,
  });
  if (charged.charged > 0) {
    await ctx.log(`Credits used for summarizing: ${charged.charged} (${summaryQuote.articleCount} articles, ~${summaryQuote.approxTokens.toLocaleString("en-US")} tokens)`);
  }
  await logDecision(projectId, 5, "summaries_generated", null, { papers: papers.length, failed, creditsUsed: charged.charged, approxTokens: summaryQuote.approxTokens }, "ai");
  if (failed) await ctx.log(force ? `${failed} papers could not be summarised again; the rows they already had were kept. Use “Retry missing summaries” for any paper still without a row.` : `${failed} papers could not be summarised; their cells show as missing. Re-run this stage to retry them.`);
}
