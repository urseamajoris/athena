/*
 * Test fixtures written straight into the (throwaway) database: a small review that has reached every stage,
 * so a test can break exactly one thing and check what the shipped code does about it.
 * Import "./env" before this module.
 */
import { eq } from "drizzle-orm";
import { db, ready, schema } from "../db";
import type { StageState } from "../db/schema";
import { STAGES } from "../shared/stages";
import { newId } from "../util";
import { testUser } from "./auth";

export const ABSTRACT =
  "BACKGROUND: Telemedicine use in Southeast Asia grew quickly. METHODS: We surveyed 412 rural clinics in Thailand and Vietnam between 2019 and 2021. " +
  "RESULTS: Uptake of teleconsultation rose sharply in rural districts, but clinicians reported that poor connectivity limited video visits. " +
  "CONCLUSIONS: Infrastructure investment is needed before telemedicine can be scaled in remote provinces.";

export function allStates(state: StageState): Record<string, StageState> {
  return Object.fromEntries(STAGES.map((s) => [String(s.n), state]));
}

export async function setStates(projectId: string, states: Record<string, StageState>, extra: Partial<typeof schema.projects.$inferInsert> = {}) {
  await db.update(schema.projects).set({ stageStates: states, staleReasons: {}, ...extra }).where(eq(schema.projects.id, projectId)).run();
}

export interface Seeded {
  projectId: string;
  topicId: string;
  queryIds: string[];
  runIds: string[];
  paperIds: string[];
  scoreIds: string[];
  appraisalIds: string[];
  /** claimIds[i] are the claims of paperIds[i]; claim 0 of each paper is a verified key finding. */
  claimIds: string[][];
  synthesisIds: string[];
  contradictionId: string;
  cellIds: string[];
  questionId: string;
}

/**
 * A complete review: 1 topic, a PubMed and an OpenAlex query (dry-run, 120 hits each), 4 retrieved papers with
 * summaries, all 4 scored and selected, appraised with verified quotes, synthesised, and a chosen question with
 * a finished novelty check. Every stage is approved and the project is "complete".
 */
export async function seedReview(paperCount = 4): Promise<Seeded> {
  if (paperCount < 2) throw new Error("seedReview needs at least 2 papers (the contradiction spans two)");
  // Each test file is its own process with a fresh throwaway DB: apply the migrations before the first insert.
  await ready();
  const ownerId = await testUser(); // signed in, so dispatch() calls on this project pass requireUser()/ownedProject()
  const projectId = newId("prj");
  const criteria = { yearFrom: 2015, yearTo: null, languages: ["en"], studyTypes: [], inclusion: ["Southeast Asia"], exclusion: ["Editorials"] };
  await db.insert(schema.projects)
    .values({
      id: projectId,
      ownerId,
      idea: "What is the knowledge gap in implementing telemedicine in Southeast Asia?",
      title: "Telemedicine in Southeast Asia",
      stageStates: allStates("approved"),
      status: "complete",
      currentStage: 9,
      criteria,
      scopingSummary: { population: "Rural patients", setting: "Southeast Asia", phenomenon: "Telemedicine", outcome: "Adoption", timeframe: "2015 onwards", studyTypes: "Any" },
    })
    .run();
  const topicId = newId("t");
  await db.insert(schema.topics).values({ id: topicId, projectId, name: "Telemedicine adoption", synonyms: ["telehealth"], approved: true, origin: "ai" }).run();
  await db.insert(schema.decisionLog).values({ id: newId("log"), projectId, stage: 2, action: "topics_generated" }).run();

  const queryIds: string[] = [];
  const runIds: string[] = [];
  for (const [i, database] of ["pubmed", "openalex"].entries()) {
    const id = newId("q");
    const qs = database === "pubmed" ? "telemedicine[tiab] AND Thailand[tiab]" : '"telemedicine" AND Thailand';
    await db.insert(schema.queries).values({ id, projectId, topicId, database, queryString: qs, aiQueryString: qs, dryRunCount: 120, dryRunAt: "2026-11-01T00:00:00.000Z" }).run();
    queryIds.push(id);
    const runId = newId("run");
    await db.insert(schema.searchRuns).values({ id: runId, projectId, queryId: id, database, queryString: qs, criteria, status: "done", resultCount: 120, fetchedCount: paperCount, newUniqueCount: i ? 0 : paperCount, cap: 40, order: i }).run();
    runIds.push(runId);
  }

  const paperIds: string[] = [];
  const scoreIds: string[] = [];
  const appraisalIds: string[] = [];
  const claimIds: string[][] = [];
  for (let i = 0; i < paperCount; i++) {
    const id = newId("p");
    const title = `Teleconsultation uptake in rural Thailand, cohort ${i + 1}`;
    await db.insert(schema.papers).values({ id, projectId, doi: `10.1000/tele.${i + 1}`, pmid: String(30000000 + i), title, normTitle: title.toLowerCase(), authors: [`Nguyen A${i}`], year: 2020 + (i % 4), abstract: ABSTRACT, sourceDatabases: ["pubmed"] }).run();
    await db.insert(schema.paperTopics).values({ paperId: id, topicId }).run();
    for (const r of runIds) await db.insert(schema.paperHits).values({ paperId: id, searchRunId: r, rank: i }).run();
    await db.insert(schema.paperSummaries).values({ id: `s_${id}`, paperId: id, studyType: "cross_sectional", setting: "Rural Thailand", keyFinding: "Uptake rose; connectivity limited video visits.", model: "mock:grok" }).run();
    const scoreId = newId("sc");
    await db.insert(schema.scores).values({ id: scoreId, paperId: id, topicId, subScores: { topicFit: 4, designStrength: 3, settingMatch: 4, recency: 4, citationImpact: 2 }, rationales: { topicFit: "", designStrength: "", settingMatch: "", recency: "", citationImpact: "" }, total: 80 - i, rationale: "Relevant", selected: true }).run();
    scoreIds.push(scoreId);
    const stId = newId("st");
    await db.insert(schema.sourceTexts).values({ id: stId, paperId: id, kind: "abstract", source: "pubmed", text: ABSTRACT, fullLength: ABSTRACT.length }).run();
    const appraisalId = newId("ap");
    const claimOk = newId("c");
    const claimLim = newId("c");
    await db.insert(schema.appraisals)
      .values({ id: appraisalId, paperId: id, sourceTextId: stId, textSource: "abstract", templateType: "cross_sectional", status: "done", checklist: [{ item: "Was the sample representative?", answer: "yes", claimId: claimLim }] })
      .run();
    await db.insert(schema.claims).values({ id: claimOk, appraisalId, paperId: id, field: "key_findings", statement: "Uptake rose in rural districts.", quote: "Uptake of teleconsultation rose sharply in rural districts", verified: true }).run();
    await db.insert(schema.claims).values({ id: claimLim, appraisalId, paperId: id, field: "checklist", statement: "Representative: yes", quote: "poor connectivity limited video visits", verified: true }).run();
    appraisalIds.push(appraisalId);
    claimIds.push([claimOk, claimLim]);
    paperIds.push(id);
  }

  const synthesisIds: string[] = [];
  for (const kind of ["known", "unknown"]) {
    const sid = newId("sy");
    await db.insert(schema.synthesisItems).values({ id: sid, projectId, topicId, kind, statement: `${kind}: rural uptake rose but connectivity limits video visits.` }).run();
    for (const c of claimIds) await db.insert(schema.claimLinks).values({ ownerType: "synthesis", ownerId: sid, claimId: c[0] }).run();
    synthesisIds.push(sid);
  }
  const cellIds: string[] = [];
  for (let i = 0; i < paperIds.length; i++) {
    const pid = paperIds[i];
    const id = newId("mx");
    await db.insert(schema.matrixCells).values({ id, projectId, topicId, theme: "Uptake", paperId: pid, value: "Uptake rose", stance: "supports", claimIds: [claimIds[i][0]] }).run();
    cellIds.push(id);
  }
  const contradictionId = newId("cx");
  await db.insert(schema.contradictions).values({ id: contradictionId, projectId, topicId, theme: "Connectivity", description: "Papers disagree on connectivity.", claimIds: [claimIds[0][1], claimIds[1][1]], paperIds: [paperIds[0], paperIds[1]] }).run();

  const questionId = newId("rq");
  await db.insert(schema.researchQuestions)
    .values({
      id: questionId,
      projectId,
      text: "Among rural clinics in Thailand, does connectivity investment increase teleconsultation uptake?",
      framework: "PICO",
      structure: { Population: "Rural clinics in Thailand", Intervention: "Connectivity investment" },
      design: "Cluster trial",
      gap: "No trial has tested connectivity investment.",
      feasibility: "Feasible",
      weakness: "Confounding",
      noveltyQueries: [{ database: "pubmed", query: "telemedicine AND connectivity", count: 12, error: null }],
      noveltyStatus: "done",
      chosen: true,
    })
    .run();
  await db.insert(schema.claimLinks).values({ ownerType: "research_question", ownerId: questionId, claimId: claimIds[0][0] }).run();
  // Every job stage has a finished job, as after a real run.
  for (const s of STAGES.filter((x) => x.job)) await db.insert(schema.jobs).values({ id: newId("job"), projectId, kind: s.job!, stage: s.n, status: "done" }).run();
  return { projectId, topicId, queryIds, runIds, paperIds, scoreIds, appraisalIds, claimIds, synthesisIds, contradictionId, cellIds, questionId };
}

/** Wait until no job of this project is queued or running (jobs run in-process in MOCK_MODE). */
export async function settleJobs(projectId: string, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const live = (await db.select().from(schema.jobs).where(eq(schema.jobs.projectId, projectId)).all()).filter((j) => j.status === "queued" || j.status === "running");
    if (!live.length) return;
    if (Date.now() > end) throw new Error(`jobs still running: ${live.map((j) => j.kind).join(", ")}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function stateOf(projectId: string, n: number): Promise<StageState> {
  return (await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get())!.stageStates[String(n)];
}
