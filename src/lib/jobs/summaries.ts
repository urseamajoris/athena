import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { structuredCall, unknownIds, AiValidationError, BudgetError } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { SummaryRows } from "../stages/ai-schemas";
import { chunk, errMsg } from "../util";
import { logDecision } from "../project";
import type { JobContext } from "./runner";

const BATCH = 8;
const MAX_ABSTRACT = 2500;

export async function summariesJob(ctx: JobContext) {
  const { projectId } = ctx;
  const papers = db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const done = new Set(
    db.select({ id: schema.paperSummaries.paperId }).from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, papers.map((p) => p.id).concat(["-"]))).all().map((r) => r.id),
  );
  const force = !!ctx.params.force;
  if (force) {
    db.delete(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, papers.map((p) => p.id).concat(["-"]))).run();
    done.clear();
  }
  const todo = papers.filter((p) => !done.has(p.id));
  // Papers with no abstract get "not reported" without a model call (nothing to summarise).
  const noAbs = todo.filter((p) => !p.abstract || p.abstract.length < 80);
  for (const p of noAbs) {
    db.insert(schema.paperSummaries).values({ id: `s_${p.id}`, paperId: p.id, studyType: "not_reported", setting: "not reported (no abstract available)", keyFinding: "not reported (no abstract available)", abstractDerived: true, model: null, promptVersion: null }).onConflictDoNothing().run();
  }
  const withAbs = todo.filter((p) => !noAbs.includes(p));
  const batches = chunk(withAbs, BATCH);
  let finished = 0;
  let failed = 0;
  ctx.progress(0, batches.length, `Summarising ${withAbs.length} abstracts (${noAbs.length} without abstract)`);
  await Promise.all(
    batches.map(async (batch) => {
      if (ctx.cancelled()) return;
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
          mockInput: batch,
          check: (o) => {
            const bad = unknownIds(o.rows.map((r) => r.paperId), ids);
            if (bad.length) return `Unknown paperId(s): ${bad.join(", ")}`;
            const missing = ids.filter((id) => !o.rows.some((r) => r.paperId === id));
            return missing.length ? `Missing rows for: ${missing.join(", ")}` : null;
          },
        });
        for (const r of data.rows) {
          db.insert(schema.paperSummaries)
            .values({ id: `s_${r.paperId}`, paperId: r.paperId, studyType: r.studyType, setting: r.setting, keyFinding: r.keyFinding, abstractDerived: true, model, promptVersion })
            .onConflictDoNothing()
            .run();
        }
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        failed += batch.length;
        ctx.log(`Batch failed (${e instanceof AiValidationError ? "validation" : "error"}): ${errMsg(e)}`);
      } finally {
        finished++;
        ctx.progress(finished, batches.length, `Summarised ${finished}/${batches.length} batches`);
      }
    }),
  );
  logDecision(projectId, 5, "summaries_generated", null, { papers: papers.length, failed }, "ai");
  if (failed) ctx.log(`${failed} papers could not be summarised; their cells show as missing. Re-run this stage to retry them.`);
  if (failed && failed === withAbs.length && withAbs.length > 0) throw new Error("All summary batches failed.");
}
