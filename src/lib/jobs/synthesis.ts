import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite, type BatchItem } from "../db";
import { structuredCall, unknownIds, isAiStop, repairId } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { Synthesis } from "../stages/ai-schemas";
import { STUDY_TYPE_LABEL, type StudyType } from "../shared/stages";
import { errMsg, newId } from "../util";
import { getProject, logDecision } from "../project";
import type { JobContext } from "./runner";

/** Claims that synthesis may cite: verified quotes, or unverified ones the user explicitly accepted. */
export async function usableClaims(paperIds: string[]) {
  return (await db
      .select()
      .from(schema.claims)
      .where(inArray(schema.claims.paperId, paperIds.concat(["-"])))
      .all())
    .filter((c) => !c.notReported && !c.userRejected && (c.verified || c.userAccepted));
}

export async function synthesisJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = (await getProject(projectId));
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all());
  const oldItems = (await db.select({ id: schema.synthesisItems.id }).from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all()).map((r) => r.id);
  (await db.delete(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, oldItems.concat(["-"])))).run());
  for (const t of topics) {
    (await db.delete(schema.synthesisItems).where(eq(schema.synthesisItems.topicId, t.id)).run());
    (await db.delete(schema.matrixCells).where(eq(schema.matrixCells.topicId, t.id)).run());
    (await db.delete(schema.contradictions).where(eq(schema.contradictions.topicId, t.id)).run());
  }

  let finished = 0;
  let ok = 0;
  (await ctx.progress(0, topics.length, `Synthesising ${topics.length} topics`));
  await Promise.all(
    topics.map(async (t) => {
      if ((await ctx.cancelled())) return;
      try {
        const sel = (await db.select().from(schema.scores).where(and(eq(schema.scores.topicId, t.id), eq(schema.scores.selected, true))).all());
        const pids = sel.map((s) => s.paperId);
        const papers = (await db.select().from(schema.papers).where(inArray(schema.papers.id, pids.concat(["-"]))).all());
        const apps = (await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, pids.concat(["-"]))).all());
        const sums = (await db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, pids.concat(["-"]))).all());
        const claims = (await usableClaims(pids));
        if (claims.length < 2) {
          (await ctx.log(`Topic "${t.name}": fewer than 2 usable (verified or accepted) claims — skipped.`));
          return;
        }
        const claimIds = claims.map((c) => c.id);
        const paperIds = papers.map((x) => x.id);
        const { data } = await structuredCall({
          prompt: "synthesis",
          role: "reasoning",
          schema: Synthesis,
          projectId,
          stage: 8,
          vars: {
            idea: wrapData("research idea", p.idea),
            topic: `${t.name} — ${t.rationale}`,
            papers: wrapData(
              "papers",
              papers
                .map((x) => {
                  const a = apps.find((y) => y.paperId === x.id);
                  const s = sums.find((y) => y.paperId === x.id);
                  // First author and journal let the model tell a preprint and its journal version apart as one study.
                  return `${x.id} — ${x.title} — ${x.authors[0] ?? "n/a"} — ${x.journal ?? "n/a"} — ${x.year ?? "n/a"} — ${STUDY_TYPE_LABEL[(s?.studyType ?? "not_reported") as StudyType] ?? s?.studyType} — ${a?.textSource === "full_text" ? "full text" : "abstract only"}`;
                })
                .join("\n"),
            ),
            claims: wrapData("claims", claims.map((c) => `${c.id} | ${c.paperId} | ${c.field} | ${c.statement} | quote: "${c.quote}"`).join("\n")),
          },
          mockInput: { claims, papers, topic: t },
          normalize: (o) => {
            const fc = (a: string[]) => a.map((x) => repairId(x, claimIds));
            return {
              ...o,
              matrix: o.matrix.map((m) => ({ ...m, paperId: repairId(m.paperId, paperIds), claimIds: fc(m.claimIds) })),
              contradictions: o.contradictions.map((c) => ({ ...c, claimIds: fc(c.claimIds) })),
              known: o.known.map((k) => ({ ...k, claimIds: fc(k.claimIds) })),
              contested: o.contested.map((k) => ({ ...k, claimIds: fc(k.claimIds) })),
              unknown: o.unknown.map((k) => ({ ...k, claimIds: fc(k.claimIds) })),
            };
          },
          check: (o) => {
            const cited = [...o.matrix.flatMap((m) => m.claimIds), ...o.contradictions.flatMap((c) => c.claimIds), ...o.known.flatMap((k) => k.claimIds), ...o.contested.flatMap((k) => k.claimIds), ...o.unknown.flatMap((k) => k.claimIds)];
            const badC = unknownIds(cited, claimIds);
            if (badC.length) return `Unknown claim IDs: ${badC.join(", ")}`;
            const badP = unknownIds(o.matrix.map((m) => m.paperId), paperIds);
            if (badP.length) return `Unknown paper IDs: ${badP.join(", ")}`;
            const byId = new Map(claims.map((c) => [c.id, c.paperId]));
            const sameP = o.contradictions.filter((c) => new Set(c.claimIds.map((id) => byId.get(id))).size < 2);
            if (sameP.length) return "Each contradiction must cite claims from at least two different papers.";
            const wrongPaper = o.matrix.filter((m) => m.claimIds.some((id) => byId.get(id) !== m.paperId));
            if (wrongPaper.length) return "Matrix cells may only cite claims from the same paper as the cell.";
            if (!o.known.length && !o.contested.length && !o.unknown.length) return "Provide at least one known, contested or unknown statement.";
            return null;
          },
        });
        const byId = new Map(claims.map((c) => [c.id, c.paperId]));
        {
    const stmts: BatchItem<"sqlite">[] = [];
                    for (const m of data.matrix) {
                      if (m.stance === "not_addressed" && !m.claimIds.length) continue;
                      stmts.push(db.insert(schema.matrixCells).values({ id: newId("mx"), projectId, topicId: t.id, theme: m.theme, paperId: m.paperId, value: m.value, stance: m.stance, claimIds: m.claimIds }));
                    }
                    for (const c of data.contradictions) {
                      stmts.push(db.insert(schema.contradictions).values({ id: newId("cx"), projectId, topicId: t.id, theme: c.theme, description: c.description, claimIds: c.claimIds, paperIds: [...new Set(c.claimIds.map((id) => byId.get(id)!))] }));
                    }
                    for (const kind of ["known", "contested", "unknown"] as const) {
                      for (const s of data[kind]) {
                        const id = newId("sy");
                        stmts.push(db.insert(schema.synthesisItems).values({ id, projectId, topicId: t.id, kind, statement: s.statement }));
                        for (const cid of new Set(s.claimIds)) stmts.push(db.insert(schema.claimLinks).values({ ownerType: "synthesis", ownerId: id, claimId: cid }).onConflictDoNothing());
                      }
                    }
                    await batchWrite(stmts);
  }
        ok++;
        (await ctx.log(`✓ "${t.name}": ${data.themes.length} themes, ${data.contradictions.length} contradictions`));
      } catch (e) {
        if (isAiStop(e)) throw e;
        (await ctx.log(`✗ synthesis failed for "${t.name}": ${errMsg(e)}`));
      } finally {
        finished++;
        (await ctx.progress(finished, topics.length, `Synthesised ${finished}/${topics.length} topics`));
      }
    }),
  );
  (await logDecision(projectId, 8, "synthesis_generated", null, { topics: topics.length, ok }, "ai"));
  if (!ok) throw new Error("No topic could be synthesised. Check that appraisals produced verified claims.");
}
