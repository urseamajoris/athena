import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { NoveltyMatch } from "../db/schema";
import { structuredCall, unknownIds, repairId } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { pairsToRecord, QuestionRevisions } from "../stages/ai-schemas";
import { adapters } from "../sources";
import { SEARCH_DATABASES } from "../sources/types";
import { dropEmptyGroups } from "../sources/syntax";
import { errMsg, newId, normalizeTitle, forEachSeq } from "../util";
import { getProject, logDecision } from "../project";
import { questionText, workingQuestion, workingQuestionCandidate } from "../stages/rules";
import type { JobContext } from "./runner";
import type { PromptVars } from "../stages/prompt-vars";

const NOVELTY_TOP = 5;

/**
 * Final question (stage 9). The candidates are, in order: the working research question itself, unchanged (made
 * here without the model, so the user can always keep it), then up to three revisions of it that the model
 * proposes from the evidence summary. Each candidate gets a novelty search: real records from the databases.
 */
export async function questionsJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = (await getProject(projectId));
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all());
  const items = (await db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all());
  if (!items.length) throw new Error("There is no evidence summary yet. Finish the evidence summary first.");
  const links = (await db.select().from(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, items.map((i) => i.id)))).all());
  const claimIds = [...new Set(links.map((l) => l.claimId))];
  const claims = (await db.select().from(schema.claims).where(inArray(schema.claims.id, claimIds.concat(["-"]))).all());

  const oldQs = (await db.select({ id: schema.researchQuestions.id }).from(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).all()).map((r) => r.id);
  (await db.delete(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "research_question"), inArray(schema.claimLinks.ownerId, oldQs.concat(["-"])))).run());
  (await db.delete(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).run());

  // The working question first, as it stands. A review with no working question has only the model's candidates.
  const working = workingQuestion(p);
  const qIds: string[] = [];
  if (working) {
    const id = newId("rq");
    qIds.push(id);
    (await db.insert(schema.researchQuestions).values({ id, projectId, ...workingQuestionCandidate(working) }).run());
  }

  (await ctx.progress(0, 2, "Looking for revisions of your question that the evidence supports"));
  const synthesisIds = items.map((i) => i.id);
  const { data } = await structuredCall({
    prompt: "research_questions",
    role: "reasoning",
    schema: QuestionRevisions,
    projectId,
    stage: 9,
    vars: {
      question: wrapData("working research question", questionText(working)),
      idea: wrapData("research idea", p.idea),
      summary: wrapData("scope", JSON.stringify(p.scopingSummary ?? {})),
      topics: wrapData("topics", topics.map((t, i) => `${i + 1}. ${t.name} — ${t.importanceJustification ?? t.rationale}`).join("\n")),
      synthesis: wrapData(
        "evidence summary",
        items
          .map((i) => `${i.id} — ${topics.find((t) => t.id === i.topicId)?.name} — ${i.kind} — ${i.statement} — [${links.filter((l) => l.ownerId === i.id).map((l) => l.claimId).join(", ")}]`)
          .join("\n"),
      ),
      claims: wrapData("claims", claims.map((c) => `${c.id} — ${c.paperId} — ${c.field} — ${c.statement}`).join("\n")),
    } satisfies PromptVars<"research_questions">,
    normalize: (o) => ({
      ...o,
      revisions: o.revisions.map((q) => ({ ...q, gapClaimIds: q.gapClaimIds.map((x) => repairId(x, claimIds)), synthesisIds: q.synthesisIds.map((x) => repairId(x, synthesisIds)) })),
    }),
    check: (o) => {
      const bad = unknownIds(o.revisions.flatMap((q) => q.gapClaimIds), claimIds);
      if (bad.length) return `Unknown claim IDs: ${bad.join(", ")}`;
      const badS = unknownIds(o.revisions.flatMap((q) => q.synthesisIds), synthesisIds);
      if (badS.length) return `Unknown synthesis IDs: ${badS.join(", ")}`;
      const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      if (working && o.revisions.some((q) => same(q.text, working.text))) return "A revision must differ from the working question; the working question is already offered unchanged.";
      if (o.revisions.some((q, i) => o.revisions.some((r, j) => j < i && same(q.text, r.text)))) return "The revisions must differ from each other.";
      if (!working && !o.revisions.length) return "No working question is set, so propose at least one question.";
      return null;
    },
  });

  if (working) {
    (await db.update(schema.researchQuestions)
          .set({ noveltyQueries: SEARCH_DATABASES.map((d) => ({ database: d, query: dropEmptyGroups(data.workingQuestionSearch[d]), count: null, error: null })) })
          .where(eq(schema.researchQuestions.id, qIds[0]))
          .run());
  }
  await forEachSeq(data.revisions, async (q, i) => {
    const id = newId("rq");
    qIds.push(id);
    (await db.insert(schema.researchQuestions).values({
            id,
            projectId,
            text: q.text,
            framework: q.framework,
            structure: pairsToRecord(q.structure),
            design: q.design,
            gap: q.gap,
            feasibility: q.feasibility,
            weakness: q.weakness,
            noveltyQueries: SEARCH_DATABASES.map((d) => ({ database: d, query: dropEmptyGroups(q.noveltyQueries[d]), count: null, error: null })),
            // The working question is candidate 0; revisions follow in the order the model gave them.
            order: i + 1,
          }).run());
    // Link the gap to its claims, including claims behind the cited evidence-summary statements.
    const viaSynth = links.filter((l) => q.synthesisIds.includes(l.ownerId)).map((l) => l.claimId);
    for (const cid of new Set([...q.gapClaimIds, ...viaSynth])) (await db.insert(schema.claimLinks).values({ ownerType: "research_question", ownerId: id, claimId: cid }).onConflictDoNothing().run());
  });

  // Novelty check: a fresh targeted search per candidate. Results are real records from the databases.
  const reviewed = new Set((await db.select({ t: schema.papers.normTitle }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all()).map((r) => r.t));
  const total = qIds.length + 1;
  for (const [i, id] of qIds.entries()) {
    if ((await ctx.cancelled())) return;
    (await ctx.progress(i + 1, total, working && i === 0 ? "Checking what is already published on your question" : `Checking what is already published on revision ${working ? i : i + 1}`));
    await runNovelty(id, reviewed, async (l) => (await ctx.log(l)));
  }
  (await logDecision(projectId, 9, "questions_generated", null, { workingQuestion: working?.text ?? null, revisions: data.revisions.map((q) => q.text) }, "ai"));
  (await ctx.progress(total, total, "Done"));
}

export async function runNovelty(questionId: string, reviewed: Set<string>, log: (l: string) => void) {
  const q = (await db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.id, questionId)).get());
  if (!q) return;
  const project = (await getProject(q.projectId));
  const matches: NoveltyMatch[] = [];
  const nq = [...q.noveltyQueries];
  for (const entry of nq) {
    try {
      const adapter = adapters[entry.database as "pubmed" | "openalex"];
      const res = await adapter.search(entry.query, project.criteria, NOVELTY_TOP, { log });
      entry.count = res.total;
      entry.error = null;
      res.records.slice(0, NOVELTY_TOP).forEach((r, rank) =>
        matches.push({
          title: r.title,
          year: r.year,
          doi: r.doi,
          pmid: r.pmid,
          openalexId: r.openalexId,
          database: entry.database,
          similarityNote: `#${rank + 1} by ${adapter.label} relevance for the novelty query${reviewed.has(normalizeTitle(r.title)) ? " · already in your review" : ""}`,
        }),
      );
    } catch (e) {
      entry.error = errMsg(e);
      log(`The novelty search in ${entry.database} did not work: ${errMsg(e)}`);
    }
  }
  // De-duplicate across databases by DOI/PMID/title.
  const seen = new Set<string>();
  const uniq = matches.filter((m) => {
    const k = m.doi ?? m.pmid ?? normalizeTitle(m.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  (await db.update(schema.researchQuestions)
        .set({ noveltyQueries: nq, noveltyMatches: uniq, noveltyStatus: nq.every((x) => x.error) ? "failed" : "done" })
        .where(eq(schema.researchQuestions.id, questionId))
        .run());
}
