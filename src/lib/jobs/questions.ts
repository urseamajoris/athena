import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { Criteria, NoveltyMatch } from "../db/schema";
import { structuredCall, unknownIds, repairId } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { ResearchQuestions } from "../stages/ai-schemas";
import { adapters } from "../sources";
import { SEARCH_DATABASES } from "../sources/types";
import { errMsg, newId, normalizeTitle } from "../util";
import { getProject, logDecision } from "../project";
import { noveltySearchesOutdatedIds } from "../views";
import type { JobContext } from "./runner";

const NOVELTY_TOP = 5;

type NoveltyQuery = (typeof schema.researchQuestions.$inferSelect)["noveltyQueries"][number];

/**
 * Propose three candidate questions and run a novelty search for each. The stored questions (including the chosen
 * and edited one) are not touched until the new set is complete: it is swapped in at the end, in one transaction,
 * only if the run was not cancelled. A failed or cancelled run leaves the previous questions as they were, and
 * the text a successful run replaces is written to the decision log first.
 */
export async function questionsJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = getProject(projectId);
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all();
  const items = db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all();
  if (!items.length) throw new Error("No synthesis statements yet — run the Synthesis stage first.");
  const links = db.select().from(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, items.map((i) => i.id)))).all();
  const claimIds = [...new Set(links.map((l) => l.claimId))];
  const claims = db.select().from(schema.claims).where(inArray(schema.claims.id, claimIds.concat(["-"]))).all();

  ctx.progress(0, 4, "Drafting three candidate questions");
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
    mockInput: { items, links, claims, topics },
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

  // Novelty check: a fresh targeted search per candidate. Results are real records from the databases.
  const reviewed = new Set(db.select({ t: schema.papers.normTitle }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all().map((r) => r.t));
  const criteria = noveltyCriteria(p.criteria);
  const novelty: Awaited<ReturnType<typeof searchNovelty>>[] = [];
  for (const [i, q] of data.questions.entries()) {
    if (ctx.cancelled()) return;
    ctx.progress(i + 1, 4, `Novelty search for candidate ${i + 1}`);
    novelty.push(await searchNovelty(SEARCH_DATABASES.map((d) => ({ database: d, query: q.noveltyQueries[d], count: null, error: null })), criteria, reviewed, (l) => ctx.log(l)));
  }
  // Cancelled: the previous questions are untouched.
  if (ctx.cancelled()) return;

  const old = db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).orderBy(asc(schema.researchQuestions.order)).all();
  if (old.length) {
    logDecision(
      projectId,
      9,
      "questions_replaced",
      old.map((q) => ({ text: q.text, structure: q.structure, design: q.design, gap: q.gap, chosen: q.chosen, edited: q.edited })),
      { jobId: ctx.jobId, replaced: old.length },
      "system",
    );
  }
  db.transaction((tx) => {
    tx.delete(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "research_question"), inArray(schema.claimLinks.ownerId, old.map((q) => q.id).concat(["-"])))).run();
    tx.delete(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).run();
    data.questions.forEach((q, i) => {
      const id = newId("rq");
      const n = novelty[i];
      tx.insert(schema.researchQuestions).values({
        id,
        projectId,
        text: q.text,
        framework: q.framework,
        structure: Object.fromEntries(q.structure.map((s) => [s.element, s.value])),
        design: q.design,
        gap: q.gap,
        feasibility: q.feasibility,
        weakness: q.weakness,
        noveltyQueries: n.queries,
        noveltyMatches: n.matches,
        noveltyStatus: n.allFailed ? "failed" : "done",
        order: i,
      }).run();
      // Link the gap to its claims, including claims behind the cited synthesis statements.
      const viaSynth = links.filter((l) => q.synthesisIds.includes(l.ownerId)).map((l) => l.claimId);
      for (const cid of new Set([...q.gapClaimIds, ...viaSynth])) tx.insert(schema.claimLinks).values({ ownerType: "research_question", ownerId: id, claimId: cid }).onConflictDoNothing().run();
    });
  });
  logDecision(projectId, 9, "questions_generated", null, data.questions.map((q) => q.text), "ai");
  ctx.progress(4, 4, "Done");
}

/**
 * Novelty search filters: the review's year and language limits are cleared, because an existing study outside the
 * review's window still answers "has this been done?". The adapters' own record-type filter (OpenAlex: articles,
 * reviews and preprints) still applies.
 */
export function noveltyCriteria(c: Criteria | null): Criteria | null {
  return c ? { ...c, yearFrom: null, yearTo: null, languages: [] } : null;
}

/** Run the novelty searches as written. Nothing is stored; a search that fails is recorded on its entry. */
export async function searchNovelty(queries: NoveltyQuery[], criteria: Criteria | null, reviewed: Set<string>, log: (l: string) => void) {
  const matches: NoveltyMatch[] = [];
  const nq = queries.map((x) => ({ ...x }));
  for (const entry of nq) {
    try {
      const adapter = adapters[entry.database as "pubmed" | "openalex"];
      const res = await adapter.search(entry.query, criteria, NOVELTY_TOP, { log });
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
  return { queries: nq, matches: uniq, allFailed: nq.every((x) => x.error) };
}

/**
 * Re-run a stored question's novelty searches exactly as stored. The search strings are not rewritten here, so
 * if the question's wording changed after they were written (and they were not edited since), the result still
 * checks the earlier wording and the check stays "outdated".
 */
export async function runNovelty(questionId: string, reviewed: Set<string>, log: (l: string) => void) {
  const q = db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.id, questionId)).get();
  if (!q) return;
  const project = getProject(q.projectId);
  const r = await searchNovelty(q.noveltyQueries, noveltyCriteria(project.criteria), reviewed, log);
  const forEarlierWording = noveltySearchesOutdatedIds(q.projectId).has(q.id);
  db.update(schema.researchQuestions)
    .set({ noveltyQueries: r.queries, noveltyMatches: r.matches, noveltyStatus: forEarlierWording ? "outdated" : r.allFailed ? "failed" : "done" })
    .where(eq(schema.researchQuestions.id, questionId))
    .run();
}
