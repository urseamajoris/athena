import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { NoveltyMatch } from "../db/schema";
import { structuredCall, unknownIds, repairId } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { ResearchQuestions } from "../stages/ai-schemas";
import { adapters } from "../sources";
import { SEARCH_DATABASES } from "../sources/types";
import { dropEmptyGroups } from "../sources/syntax";
import { errMsg, newId, normalizeTitle, forEachSeq } from "../util";
import { getProject, logDecision } from "../project";
import type { JobContext } from "./runner";

const NOVELTY_TOP = 5;

export async function questionsJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = (await getProject(projectId));
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all());
  const items = (await db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all());
  if (!items.length) throw new Error("No synthesis statements yet — run the Synthesis stage first.");
  const links = (await db.select().from(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, items.map((i) => i.id)))).all());
  const claimIds = [...new Set(links.map((l) => l.claimId))];
  const claims = (await db.select().from(schema.claims).where(inArray(schema.claims.id, claimIds.concat(["-"]))).all());

  const oldQs = (await db.select({ id: schema.researchQuestions.id }).from(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).all()).map((r) => r.id);
  (await db.delete(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "research_question"), inArray(schema.claimLinks.ownerId, oldQs.concat(["-"])))).run());
  (await db.delete(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).run());

  (await ctx.progress(0, 4, "Drafting three candidate questions"));
  const { data } = await structuredCall({
    prompt: "research_questions",
    role: "reasoning",
    schema: ResearchQuestions,
    projectId,
    stage: 9,
    vars: {
      idea: wrapData("research idea", p.idea),
      summary: wrapData("scoping summary", JSON.stringify(p.scopingSummary ?? {})),
      topics: topics.map((t, i) => `${i + 1}. ${t.name} — ${t.importanceJustification ?? t.rationale}`).join("\n"),
      synthesis: wrapData(
        "synthesis",
        items
          .map((i) => `${i.id} — ${topics.find((t) => t.id === i.topicId)?.name} — ${i.kind} — ${i.statement} — [${links.filter((l) => l.ownerId === i.id).map((l) => l.claimId).join(", ")}]`)
          .join("\n"),
      ),
      claims: wrapData("claims", claims.map((c) => `${c.id} — ${c.paperId} — ${c.field} — ${c.statement}`).join("\n")),
    },
    normalize: (o) => ({
      questions: o.questions.map((q) => ({ ...q, gapClaimIds: q.gapClaimIds.map((x) => repairId(x, claimIds)), synthesisIds: q.synthesisIds.map((x) => repairId(x, items.map((i) => i.id))) })),
    }),
    check: (o) => {
      const bad = unknownIds(o.questions.flatMap((q) => q.gapClaimIds), claimIds);
      if (bad.length) return `Unknown claim IDs: ${bad.join(", ")}`;
      const badS = unknownIds(o.questions.flatMap((q) => q.synthesisIds), items.map((i) => i.id));
      return badS.length ? `Unknown synthesis IDs: ${badS.join(", ")}` : null;
    },
  });

  const qIds: string[] = [];
  await forEachSeq(data.questions, async (q, i) => {
    const id = newId("rq");
    qIds.push(id);
    (await db.insert(schema.researchQuestions).values({
            id,
            projectId,
            text: q.text,
            framework: q.framework,
            structure: Object.fromEntries(q.structure.map((s) => [s.element, s.value])),
            design: q.design,
            gap: q.gap,
            feasibility: q.feasibility,
            weakness: q.weakness,
            noveltyQueries: SEARCH_DATABASES.map((d) => ({ database: d, query: dropEmptyGroups(q.noveltyQueries[d]), count: null, error: null })),
            order: i,
          }).run());
    // Link the gap to its claims, including claims behind the cited synthesis statements.
    const viaSynth = links.filter((l) => q.synthesisIds.includes(l.ownerId)).map((l) => l.claimId);
    for (const cid of new Set([...q.gapClaimIds, ...viaSynth])) (await db.insert(schema.claimLinks).values({ ownerType: "research_question", ownerId: id, claimId: cid }).onConflictDoNothing().run());
  });

  // Novelty check: a fresh targeted search per candidate. Results are real records from the databases.
  const reviewed = new Set((await db.select({ t: schema.papers.normTitle }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all()).map((r) => r.t));
  for (const [i, id] of qIds.entries()) {
    if ((await ctx.cancelled())) return;
    (await ctx.progress(i + 1, 4, `Novelty search for candidate ${i + 1}`));
    await runNovelty(id, reviewed, async (l) => (await ctx.log(l)));
  }
  (await logDecision(projectId, 9, "questions_generated", null, data.questions.map((q) => q.text), "ai"));
  (await ctx.progress(4, 4, "Done"));
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
      log(`Novelty search (${entry.database}) failed: ${errMsg(e)}`);
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
