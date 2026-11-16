// The searches of a seeded review, rebuilt from papers.json without the network (scripts/seed-fixture.ts).
// Test data only: never imported by the app.
//
// PubMed searches are real: each topic's search returns the first CAP records of the PubMed result stored in
// papers.json, in PubMed's own order, with PubMed's own hit count.
// OpenAlex searches are simulated, because the OpenAlex search API is metered and was not called. A topic's OpenAlex
// search "finds" the fixture's real records that contain the query's words (every AND group matched in the title or
// abstract as OpenAlex holds them), best match first, up to CAP. Its hit count is a fixture value (OPENALEX_TOTALS).
// One OpenAlex search fails, so the failure display has data.
//
// Records are then merged into papers exactly as the retrieval job does (src/lib/jobs/retrieval.ts: the first
// search to find a paper creates it; later ones fill gaps), so a paper found by both databases looks as it would
// after a real run.
import type { SourceRecord } from "../../src/lib/sources/types";
import { normalizeTitle } from "../../src/lib/util";
import type { FixtureFile } from "./fetch-papers";
import { CAP, TOPICS, type TopicPlan } from "./plan";

/** Hits each OpenAlex search reports. Fixture values (see the note above). */
export const OPENALEX_TOTALS: Record<TopicPlan["key"], number> = { barriers: 1482, acceptance: 1137, policy: 968, infrastructure: 1254, outcomes: 1721 };
/** The OpenAlex search that fails at retrieval, and the error the app's HTTP layer reports when OpenAlex keeps answering 429. */
export const FAILED_OPENALEX: TopicPlan["key"] = "policy";
export const OPENALEX_ERROR = "openalex: HTTP 429";

export interface SimRun {
  topic: TopicPlan;
  database: "pubmed" | "openalex";
  query: string;
  status: "done" | "failed";
  /** Hits the database reported (null for the failed search). */
  total: number | null;
  error: string | null;
  records: SourceRecord[];
  /** The fixture's key (the PMID in papers.json) of each record, in the same order. */
  keys: string[];
}

/** The OR groups of an OpenAlex query: `(a OR "b c") AND (d OR e)` -> [["a", "b c"], ["d", "e"]]. */
function groups(query: string): string[][] {
  return query.split(/\s+AND\s+/).map((g) => g.replace(/^\(|\)$/g, "").split(/\s+OR\s+/).map((t) => t.replace(/"/g, "").toLowerCase()));
}
const occurrences = (text: string, term: string) => (text.match(new RegExp(`\\b${term.replace(/s$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) ?? []).length;

function openalexSearch(file: FixtureFile, topic: TopicPlan): { key: string; r: SourceRecord }[] {
  const gs = groups(topic.openalex.query);
  return Object.entries(file.papers)
    .filter(([, p]) => p.openalex)
    .map(([key, p]) => {
      const r = p.openalex!;
      const title = r.title.toLowerCase();
      const abs = (r.abstract ?? "").toLowerCase();
      const per = gs.map((g) => g.reduce((a, term) => a + 3 * occurrences(title, term) + occurrences(abs, term), 0));
      return { key, r, ok: per.every((x) => x > 0), score: per.reduce((a, b) => a + Math.min(b, 6), 0) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score || (b.r.citationCount ?? 0) - (a.r.citationCount ?? 0) || a.key.localeCompare(b.key))
    .slice(0, CAP);
}

/** Every search of the review, in the order the retrieval job runs them: topic by topic, PubMed first. */
export function simulateRuns(file: FixtureFile): SimRun[] {
  const runs: SimRun[] = [];
  for (const topic of TOPICS) {
    const s = file.searches[topic.key];
    const pmids = s.pmids.slice(0, CAP);
    runs.push({ topic, database: "pubmed", query: topic.pubmed.query, status: "done", total: s.total, error: null, records: pmids.map((id) => file.papers[id].pubmed), keys: pmids });
    const failed = topic.key === FAILED_OPENALEX;
    const found = failed ? [] : openalexSearch(file, topic);
    runs.push({ topic, database: "openalex", query: topic.openalex.query, status: failed ? "failed" : "done", total: failed ? null : OPENALEX_TOTALS[topic.key], error: failed ? OPENALEX_ERROR : null, records: found.map((x) => x.r), keys: found.map((x) => x.key) });
  }
  return runs;
}

/** A paper as the retrieval job stores it (the columns of `papers` that come from the databases). */
export interface SimPaper {
  /** The fixture's key for the paper: its PMID in papers.json. */
  key: string;
  pmid: string | null;
  doi: string | null;
  pmcid: string | null;
  openalexId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  abstract: string | null;
  language: string | null;
  publicationTypes: string[];
  citationCount: number | null;
  oaUrl: string | null;
  oaStatus: string | null;
  license: string | null;
  sourceDatabases: string[];
  enrichment: Record<string, string>;
  /** Topic keys whose searches found the paper. */
  topics: TopicPlan["key"][];
}
export interface SimHit {
  run: number;
  key: string;
  rank: number;
  wasNew: boolean;
}

/** Fill gaps from another record of the same paper, never overwriting with nothing (mergeInto in the retrieval job). */
function merge(p: SimPaper, r: SourceRecord, source: string | null) {
  const fill = <K extends "doi" | "pmid" | "pmcid" | "openalexId" | "journal" | "year" | "language" | "oaUrl" | "oaStatus" | "license">(k: K, v: SimPaper[K]) => {
    if ((p[k] === null || p[k] === "") && v !== null && v !== undefined && v !== "") p[k] = v;
  };
  fill("doi", r.doi);
  fill("pmid", r.pmid);
  fill("pmcid", r.pmcid);
  fill("openalexId", r.openalexId);
  fill("journal", r.journal);
  fill("year", r.year);
  fill("language", r.language);
  fill("oaUrl", r.oaUrl);
  fill("oaStatus", r.oaStatus);
  fill("license", r.license);
  if (r.abstract && (!p.abstract || r.abstract.length > p.abstract.length * 1.2)) p.abstract = r.abstract;
  if (r.citationCount !== null && (p.citationCount === null || r.citationCount > p.citationCount)) p.citationCount = r.citationCount;
  if (!p.authors.length && r.authors.length) p.authors = r.authors;
  p.publicationTypes = [...new Set([...p.publicationTypes, ...r.publicationTypes])];
  if (source && !p.sourceDatabases.includes(source)) p.sourceDatabases.push(source);
}

export interface SimRetrieval {
  runs: (SimRun & { fetched: number; newUnique: number })[];
  papers: SimPaper[];
  hits: SimHit[];
  /** PubMed-only papers that the enrichment step matched in OpenAlex. */
  enriched: number;
  pubmedOnly: number;
}

/** Run the searches and merge their records into papers, then fill gaps from OpenAlex as the enrichment step does. */
export function simulateRetrieval(file: FixtureFile): SimRetrieval {
  const byKey = new Map<string, SimPaper>();
  const hits: SimHit[] = [];
  const runs = simulateRuns(file).map((run, i) => {
    let newUnique = 0;
    run.records.forEach((r, rank) => {
      // Records of one paper share a key in papers.json; the app would match them by DOI, PMID or title (checked below).
      const key = run.keys[rank];
      let p = byKey.get(key);
      const isNew = !p;
      if (!p) {
        p = { key, pmid: r.pmid, doi: r.doi, pmcid: r.pmcid, openalexId: r.openalexId, title: r.title, authors: [...r.authors], year: r.year, journal: r.journal, abstract: r.abstract, language: r.language, publicationTypes: [...r.publicationTypes], citationCount: r.citationCount, oaUrl: r.oaUrl, oaStatus: r.oaStatus, license: r.license, sourceDatabases: [run.database], enrichment: {}, topics: [] };
        byKey.set(key, p);
        newUnique++;
      } else merge(p, r, run.database);
      if (!p.topics.includes(run.topic.key)) p.topics.push(run.topic.key);
      hits.push({ run: i, key, rank, wasNew: isNew });
    });
    return { ...run, fetched: run.records.length, newUnique };
  });
  const papers = [...byKey.values()];
  // The app would treat two records as one paper if they shared a DOI or a normalised title: none of ours do.
  for (const key of ["doi", "title"] as const) {
    const seen = new Set<string>();
    for (const p of papers) {
      const v = key === "doi" ? p.doi : normalizeTitle(p.title);
      if (!v) continue;
      if (seen.has(v)) throw new Error(`Fixture papers share a ${key}: ${v}`);
      seen.add(v);
    }
  }
  const pubmedOnly = papers.filter((p) => !p.openalexId);
  let enriched = 0;
  for (const p of pubmedOnly) {
    const oa = file.papers[p.key].openalex;
    if (!oa) continue;
    merge(p, oa, null);
    p.enrichment = { ...p.enrichment, openalex: "metadata" };
    enriched++;
  }
  return { runs, papers, hits, enriched, pubmedOnly: pubmedOnly.length };
}
