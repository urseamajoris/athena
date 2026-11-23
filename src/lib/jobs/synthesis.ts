import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { structuredCall, unknownIds, BudgetError, repairId } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { Synthesis } from "../stages/ai-schemas";
import { STUDY_TYPE_LABEL, type StudyType } from "../shared/stages";
import { detectCriteriaFlags, formatCriteriaGuidance, hasNonStudyFlag } from "../shared/criteria";
import { fullTextSourceLabel } from "../appraisal-text";
import { filterClaimsForSynthesis, validateSynthesisKnownFindings } from "../review-guards";
import { errMsg, newId } from "../util";
import { getProject, logDecision } from "../project";
import type { JobContext } from "./runner";

/**
 * Claims that synthesis may cite: verified quotes within text actually sent to the model (or
 * user-accepted quotes not sourced solely from an unread tail), excluding any paper the
 * researcher has marked excluded.
 */
export function usableClaims(paperIds: string[]) {
  const safeIds = paperIds.concat(["-"]);
  const claims = db.select().from(schema.claims).where(inArray(schema.claims.paperId, safeIds)).all();
  if (!claims.length) return [];
  const papers = db.select().from(schema.papers).where(inArray(schema.papers.id, safeIds)).all();
  const appIds = [...new Set(claims.map((c) => c.appraisalId))];
  const apps = db.select().from(schema.appraisals).where(inArray(schema.appraisals.id, appIds.concat(["-"]))).all();
  const stIds = [...new Set(apps.map((a) => a.sourceTextId).filter((x): x is string => !!x))];
  const sts = stIds.length ? db.select().from(schema.sourceTexts).where(inArray(schema.sourceTexts.id, stIds)).all() : [];
  return filterClaimsForSynthesis({
    claims,
    papersById: new Map(papers.map((p) => [p.id, p])),
    appraisalsById: new Map(apps.map((a) => [a.id, a])),
    sourceTextsById: new Map(sts.map((s) => [s.id, s])),
  });
}

/**
 * Synthesise each topic. Nothing stored is touched until the run has finished: the new output is held in memory
 * and swapped in at the end, in one transaction, only if the run was not cancelled and at least one topic was
 * synthesised. A failed or cancelled run therefore still shows the previous synthesis, edited statements included.
 * In a run that succeeds overall, a topic whose AI call failed keeps its previous synthesis (recorded, and
 * acknowledged before approval); a topic with too little evidence loses it. Replaced text goes to the decision log.
 */
export async function synthesisJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = getProject(projectId);
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all();
  type Topic = (typeof topics)[number];
  type Outcome =
    | { kind: "ok"; data: Synthesis; paperOfClaim: Map<string, string> }
    /** Too little evidence: the topic has no synthesis now, whatever it had before. */
    | { kind: "no_evidence"; reason: string }
    /** The AI call failed: whatever the topic had before stays. */
    | { kind: "failed"; reason: string };
  const outcomes = new Map<string, Outcome>();

  let finished = 0;
  let ok = 0;
  const skipTopic = (t: Topic, o: Exclude<Outcome, { kind: "ok" }>) => {
    ctx.log(`✗ "${t.name}" skipped: ${o.reason}`);
    outcomes.set(t.id, o);
  };
  ctx.progress(0, topics.length, `Synthesising ${topics.length} topics`);
  await Promise.all(
    topics.map(async (t) => {
      if (ctx.cancelled()) return;
      try {
        const sel = db.select().from(schema.scores).where(and(eq(schema.scores.topicId, t.id), eq(schema.scores.selected, true))).all();
        const rawPids = sel.map((s) => s.paperId);
        const allSelectedPapers = db.select().from(schema.papers).where(inArray(schema.papers.id, rawPids.concat(["-"]))).all();
        const excludedCount = allSelectedPapers.filter((x) => x.excluded).length;
        if (excludedCount > 0) ctx.log(`Topic "${t.name}": skipped ${excludedCount} excluded paper(s).`);
        const papers = allSelectedPapers.filter((x) => !x.excluded);
        const pids = papers.map((x) => x.id);
        const apps = db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, pids.concat(["-"]))).all();
        const stIds = [...new Set(apps.map((a) => a.sourceTextId).filter((x): x is string => !!x))];
        const sts = stIds.length ? db.select().from(schema.sourceTexts).where(inArray(schema.sourceTexts.id, stIds)).all() : [];
        const stById = new Map(sts.map((s) => [s.id, s]));
        const sums = db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, pids.concat(["-"]))).all();
        const claims = usableClaims(pids);
        if (claims.length < 2) {
          const reason = !pids.length
            ? "No papers are selected for this topic in Ranking, so there was no evidence to synthesise."
            : `Only ${claims.length} usable quote${claims.length === 1 ? "" : "s"} (verified, or unverified but accepted by you) came from its ${pids.length} selected paper${pids.length === 1 ? "" : "s"}; synthesis needs at least 2.`;
          skipTopic(t, { kind: "no_evidence", reason });
          return;
        }
        const claimIds = claims.map((c) => c.id);
        const paperIds = papers.map((x) => x.id);
        const nonStudyPaperIds = new Set(
          papers
            .filter((x) => hasNonStudyFlag(detectCriteriaFlags(x, sums.find((y) => y.paperId === x.id), p.criteria)))
            .map((x) => x.id),
        );
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
                  const st = a?.sourceTextId ? stById.get(a.sourceTextId) : undefined;
                  const truncated = !!(a?.charsSentToModel && st && a.charsSentToModel < st.fullLength);
                  const srcLabel = fullTextSourceLabel(a?.textSource ?? "abstract", st?.source, truncated);
                  const flags = detectCriteriaFlags(x, s, p.criteria);
                  const flagTag = flags.length ? ` [FLAGGED: ${flags.map((f) => f.label).join(", ")}]` : "";
                  return `${x.id} — ${x.title} — ${x.year ?? "n/a"} — ${STUDY_TYPE_LABEL[(s?.studyType ?? "not_reported") as StudyType] ?? s?.studyType} — ${srcLabel}${flagTag}`;
                })
                .join("\n"),
            ),
            claims: wrapData("claims", claims.map((c) => `${c.id} | ${c.paperId} | ${c.field} | ${c.statement} | quote: "${c.quote}"`).join("\n")),
          },
          mockInput: { claims, papers, topic: t, nonStudyPaperIds: [...nonStudyPaperIds] },
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
            const knownErr = validateSynthesisKnownFindings(o.known, byId, nonStudyPaperIds);
            if (knownErr) return knownErr;
            if (!o.known.length && !o.contested.length && !o.unknown.length) return "Provide at least one known, contested or unknown statement.";
            return null;
          },
        });
        outcomes.set(t.id, { kind: "ok", data, paperOfClaim: new Map(claims.map((c) => [c.id, c.paperId])) });
        ok++;
        ctx.log(`✓ "${t.name}": ${data.themes.length} themes, ${data.contradictions.length} contradictions`);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        skipTopic(t, { kind: "failed", reason: `The AI synthesis for this topic failed: ${errMsg(e)}. Re-run this step to try again.` });
      } finally {
        finished++;
        ctx.progress(finished, topics.length, `Synthesised ${finished}/${topics.length} topics`);
      }
    }),
  );
  // Cancelled: the previous synthesis is untouched.
  if (ctx.cancelled()) return;

  const prevItems = db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all();
  const prevCells = db.select({ topicId: schema.matrixCells.topicId }).from(schema.matrixCells).where(eq(schema.matrixCells.projectId, projectId)).all();
  const prevCx = db.select().from(schema.contradictions).where(eq(schema.contradictions.projectId, projectId)).all();
  const hadSynthesis = (t: Topic) => prevItems.some((i) => i.topicId === t.id) || prevCells.some((c) => c.topicId === t.id) || prevCx.some((c) => c.topicId === t.id);
  // Why each skipped topic has no new synthesis, and whether its earlier one is still what is stored. When no
  // topic succeeded the run fails and nothing is replaced, so every earlier synthesis is kept.
  for (const t of topics) {
    const o = outcomes.get(t.id);
    if (!o || o.kind === "ok") continue;
    const keptPrevious = hadSynthesis(t) && (o.kind === "failed" || !ok);
    logDecision(projectId, 8, "synthesis_topic_skipped", null, { topicId: t.id, topic: t.name, reason: o.reason, jobId: ctx.jobId, ...(keptPrevious ? { keptPrevious: true } : {}) }, "system");
  }
  if (!ok) {
    logDecision(projectId, 8, "synthesis_generated", null, { topics: topics.length, ok }, "ai");
    throw new Error(`No topic could be synthesised. Check that appraisals produced verified claims.${prevItems.length ? " The previous synthesis was kept." : ""}`);
  }

  // Topics whose earlier synthesis is replaced (new output) or removed (too little evidence now).
  const swap = topics.filter((t) => ["ok", "no_evidence"].includes(outcomes.get(t.id)?.kind ?? ""));
  const replaced = swap.filter(hadSynthesis);
  if (replaced.length) {
    logDecision(
      projectId,
      8,
      "synthesis_replaced",
      replaced.map((t) => ({
        topicId: t.id,
        topic: t.name,
        statements: prevItems.filter((i) => i.topicId === t.id).map((i) => ({ kind: i.kind, statement: i.statement, edited: i.edited })),
        contradictions: prevCx.filter((c) => c.topicId === t.id).map((c) => c.description),
      })),
      { jobId: ctx.jobId, replaced: replaced.filter((t) => outcomes.get(t.id)?.kind === "ok").map((t) => t.name), removed: replaced.filter((t) => outcomes.get(t.id)?.kind === "no_evidence").map((t) => t.name) },
      "system",
    );
  }
  db.transaction((tx) => {
    for (const t of swap) {
      const old = prevItems.filter((i) => i.topicId === t.id).map((i) => i.id);
      tx.delete(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, old.concat(["-"])))).run();
      tx.delete(schema.synthesisItems).where(eq(schema.synthesisItems.topicId, t.id)).run();
      tx.delete(schema.matrixCells).where(eq(schema.matrixCells.topicId, t.id)).run();
      tx.delete(schema.contradictions).where(eq(schema.contradictions.topicId, t.id)).run();
      const o = outcomes.get(t.id)!;
      if (o.kind !== "ok") continue;
      const { data, paperOfClaim } = o;
      for (const m of data.matrix) {
        if (m.stance === "not_addressed" && !m.claimIds.length) continue;
        tx.insert(schema.matrixCells).values({ id: newId("mx"), projectId, topicId: t.id, theme: m.theme, paperId: m.paperId, value: m.value, stance: m.stance, claimIds: m.claimIds }).run();
      }
      for (const c of data.contradictions) {
        tx.insert(schema.contradictions).values({ id: newId("cx"), projectId, topicId: t.id, theme: c.theme, description: c.description, claimIds: c.claimIds, paperIds: [...new Set(c.claimIds.map((id) => paperOfClaim.get(id)!))] }).run();
      }
      for (const kind of ["known", "contested", "unknown"] as const) {
        for (const s of data[kind]) {
          const id = newId("sy");
          tx.insert(schema.synthesisItems).values({ id, projectId, topicId: t.id, kind, statement: s.statement }).run();
          for (const cid of new Set(s.claimIds)) tx.insert(schema.claimLinks).values({ ownerType: "synthesis", ownerId: id, claimId: cid }).onConflictDoNothing().run();
        }
      }
    }
  });
  logDecision(projectId, 8, "synthesis_generated", null, { topics: topics.length, ok }, "ai");
}
