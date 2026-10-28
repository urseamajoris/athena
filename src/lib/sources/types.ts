import type { Criteria } from "../db/schema";

export type SearchDatabase = "pubmed" | "openalex";
export const SEARCH_DATABASES: SearchDatabase[] = ["pubmed", "openalex"];

/** A normalised record exactly as returned by a database API (no model involvement). */
export interface SourceRecord {
  database: SearchDatabase | "crossref";
  doi: string | null;
  pmid: string | null;
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
}

export interface SearchAdapter {
  name: SearchDatabase;
  label: string;
  /** Total hits for a query + criteria without fetching records. */
  count(query: string, criteria: Criteria | null, log?: (l: string) => void): Promise<number>;
  /** Fetch up to `cap` records, page by page. */
  search(
    query: string,
    criteria: Criteria | null,
    cap: number,
    opts: { log?: (l: string) => void; onPage?: (records: SourceRecord[], total: number) => Promise<void> | void },
  ): Promise<{ total: number; records: SourceRecord[] }>;
  /** Syntax notes given to the model when it writes queries. */
  syntaxGuide: string;
}
