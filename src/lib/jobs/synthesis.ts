import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite, type BatchItem } from "../db";
import { structuredCall, unknownIds, isAiStop, repairId } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { Synthesis } from "../stages/ai-schemas";
import { STUDY_TYPE_LABEL, type StudyType } from "../shared/stages";
import { formatCriteriaGuidance } from "../shared/criteria";
import { detectCriteriaFlags } from "../shared/criteria";
import { filterClaimsForSynthesis } from "../review-guards";
import { fullTextSourceLabel } from "../appraisal-text";
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
  // Previous synthesis stays until a topic's new result is ready. A failed or cancelled run does not delete it.
  type Ready = { topicId: string; name: string; stmts: BatchItem<"sqlite">[]; themes: number; contradictions: number };
  const ready: Ready[] = [];
  const skipped: { topicId: string; reason: string; keptPrevious: boolean }[] = [];

  let finished = 0;
  (await ctx.progress(0, topics.length, `Synthesising ${topics.length} topics`));
  await Promise.all(
    topics.map(async (t) => {
      if ((await ctx.cancelled())) return;
      try {
        const sel = (await db.select().from(schema.scores).where(and(eq(schema.scores.topicId, t.id), eq(schema.scores.selected, true))).all());
        const rawPids = sel.map((s) => s.paperId);
        const allSelected = (await db.select().from(schema.papers).where(inArray(schema.papers.id, rawPids.concat(["-"]))).all());
        const excludedCount = allSelected.filter((x) => x.excluded).length;
        if (excludedCount) (await ctx.log(`Topic "${t.name}": skipped ${excludedCount} excluded paper(s).`));
        const papers = allSelected.filter((x) => !x.excluded);
        const pids = papers.map((x) => x.id);
        const apps = (await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, pids.concat(["-"]))).all());
        const stIds = [...new Set(apps.map((a) => a.sourceTextId).filter((x): x is string => !!x))];
        const sts = stIds.length ? (await db.select().from(schema.sourceTexts).where(inArray(schema.sourceTexts.id, stIds)).all()) : [];
        const sums = (await db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, pids.concat(["-"]))).all());
        const claims = filterClaimsForSynthesis({
          claims: await usableClaims(pids),
          papersById: new Map(papers.map((x) => [x.id, x])),
          appraisalsById: new Map(apps.map((a) => [a.id, a])),
          sourceTextsById: new Map(sts.map((s) => [s.id, s])),
        });
        if (claims.length < 2) {
          const reason = !pids.length
            ? "No papers are selected for this topic in Ranking, so there was no evidence to synthesise."
            : `Only ${claims.length} usable quote${claims.length === 1 ? "" : "s"} (verified, or unverified but accepted by you) came from its ${pids.length} selected paper${pids.length === 1 ? "" : "s"}; synthesis needs at least 2.`;
          skipped.push({ topicId: t.id, reason, keptPrevious: false });
          (await ctx.log(`Topic "${t.name}": ${reason}`));
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
            criteria: wrapData("review criteria", formatCriteriaGuidance(p.criteria)),
            topic: `${t.name} — ${t.rationale}`,
            papers: wrapData(
              "papers",
              papers
                .map((x) => {
                  const a = apps.find((y) => y.paperId === x.id);
                  const s = sums.find((y) => y.paperId === x.id);
                  const st = a?.sourceTextId ? sts.find((y) => y.id === a.sourceTextId) : undefined;
                  const truncated = !!(a?.charsSentToModel && st && a.charsSentToModel < st.fullLength);
                  const flags = detectCriteriaFlags(x, s, p.criteria);
                  const flagTag = flags.length ? ` [FLAGGED: ${flags.map((f) => f.label).join(", ")}]` : "";
                  // First author and journal let the model tell a preprint and its journal version apart as one study.
                  return `${x.id} — ${x.title} — ${x.authors[0] ?? "n/a"} — ${x.journal ?? "n/a"} — ${x.year ?? "n/a"} — ${STUDY_TYPE_LABEL[(s?.studyType ?? "not_reported") as StudyType] ?? s?.studyType} — ${fullTextSourceLabel(a?.textSource ?? "abstract", st?.source, truncated)}${flagTag}`;
                })
                .join("\n"),
            ),
            claims: wrapData("claims", claims.map((c) => `${c.id} | ${c.paperId} | ${c.field} | ${c.statement} | quote: "${c.quote}"`).join("\n")),
          },
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
                    ready.push({ topicId: t.id, name: t.name, stmts, themes: data.themes.length, contradictions: data.contradictions.length });
  }
        (await ctx.log(`✓ "${t.name}": ${data.themes.length} themes, ${data.contradictions.length} contradictions`));
      } catch (e) {
        if (isAiStop(e)) throw e;
        const reason = `AI synthesis for this topic failed: ${errMsg(e)}`;
        skipped.push({ topicId: t.id, reason, keptPrevious: true });
        (await ctx.log(`✗ synthesis failed for "${t.name}": ${errMsg(e)}`));
      } finally {
        finished++;
        (await ctx.progress(finished, topics.length, `Synthesised ${finished}/${topics.length} topics`));
      }
    }),
  );
  if ((await ctx.cancelled())) return;
  const replaced: { topic: string; statements: { statement: string; edited: boolean }[]; contradictions: string[] }[] = [];
  for (const r of ready) {
    const oldItems = (await db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.topicId, r.topicId)).all());
    const oldCx = (await db.select().from(schema.contradictions).where(eq(schema.contradictions.topicId, r.topicId)).all());
    if (oldItems.length || oldCx.length) replaced.push({ topic: r.name, statements: oldItems.map((i) => ({ statement: i.statement, edited: i.edited })), contradictions: oldCx.map((c) => c.description) });
    const oldIds = oldItems.map((i) => i.id);
    (await batchWrite([
      db.delete(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, oldIds.concat(["-"])))),
      db.delete(schema.synthesisItems).where(eq(schema.synthesisItems.topicId, r.topicId)),
      db.delete(schema.matrixCells).where(eq(schema.matrixCells.topicId, r.topicId)),
      db.delete(schema.contradictions).where(eq(schema.contradictions.topicId, r.topicId)),
      ...r.stmts,
    ]));
  }
  for (const s of skipped) {
    if (!s.keptPrevious) {
      const oldItems = (await db.select({ id: schema.synthesisItems.id }).from(schema.synthesisItems).where(eq(schema.synthesisItems.topicId, s.topicId)).all());
      (await batchWrite([
        db.delete(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, oldItems.map((i) => i.id).concat(["-"])))),
        db.delete(schema.synthesisItems).where(eq(schema.synthesisItems.topicId, s.topicId)),
        db.delete(schema.matrixCells).where(eq(schema.matrixCells.topicId, s.topicId)),
        db.delete(schema.contradictions).where(eq(schema.contradictions.topicId, s.topicId)),
      ]));
    }
    (await logDecision(projectId, 8, "synthesis_topic_skipped", null, { jobId: ctx.jobId, topicId: s.topicId, reason: s.reason, keptPrevious: s.keptPrevious }, "system"));
  }
  if (replaced.length) (await logDecision(projectId, 8, "synthesis_replaced", replaced, { jobId: ctx.jobId }, "system"));
  (await logDecision(projectId, 8, "synthesis_generated", null, { topics: topics.length, ok: ready.length }, "ai"));
  if (!ready.length) throw new Error("No topic could be synthesised. Check that appraisals produced verified claims.");
}
