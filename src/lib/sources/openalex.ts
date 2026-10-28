import "server-only";
import { config } from "../config";
import { httpJson } from "./http";
import type { SearchAdapter, SourceRecord } from "./types";
import type { Criteria } from "../db/schema";
import { normalizeDoi, chunk } from "../util";

/*
 * OpenAlex (https://help.openalex.org): API key required for real budgets ($1/day free; search $1 per 1k calls,
 * list+filter $0.10 per 1k, single-record lookups free). Key is sent as a bearer header so it never appears in URLs.
 * We request only the fields we need via select= and use per_page up to 100 with cursor paging.
 */
const BASE = "https://api.openalex.org";
const SELECT = "id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,abstract_inverted_index,cited_by_count,open_access,ids,language,type";

function headers(): Record<string, string> {
  return config.openalexApiKey ? { Authorization: `Bearer ${config.openalexApiKey}` } : {};
}

export function openalexFilter(c: Criteria | null) {
  const f = ["type:article|review|preprint"];
  if (c?.yearFrom) f.push(`from_publication_date:${c.yearFrom}-01-01`);
  if (c?.yearTo) f.push(`to_publication_date:${c.yearTo}-12-31`);
  const langs = (c?.languages ?? []).map((l) => l.toLowerCase().slice(0, 2)).filter(Boolean);
  if (langs.length) f.push(`language:${langs.join("|")}`);
  return f.join(",");
}

interface OAWork {
  id: string;
  doi: string | null;
  display_name: string | null;
  publication_year: number | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null; license?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  cited_by_count?: number;
  open_access?: { is_oa?: boolean; oa_status?: string; oa_url?: string | null };
  ids?: { pmid?: string; pmcid?: string };
  language?: string | null;
  type?: string;
}

export function invertedToText(inv: Record<string, number[]> | null | undefined): string | null {
  if (!inv) return null;
  const words: string[] = [];
  for (const [w, positions] of Object.entries(inv)) for (const p of positions) words[p] = w;
  const t = words.filter((w) => w !== undefined).join(" ").trim();
  return t || null;
}

export function mapWork(w: OAWork): SourceRecord {
  const pmid = w.ids?.pmid?.match(/(\d+)\/?$/)?.[1] ?? null;
  const pmcNum = w.ids?.pmcid?.match(/(\d+)\/?$/)?.[1];
  return {
    database: "openalex",
    doi: normalizeDoi(w.doi),
    pmid,
    pmcid: pmcNum ? `PMC${pmcNum}` : null,
    openalexId: w.id.replace("https://openalex.org/", ""),
    title: (w.display_name ?? "").trim(),
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
    year: w.publication_year ?? null,
    journal: w.primary_location?.source?.display_name ?? null,
    abstract: invertedToText(w.abstract_inverted_index),
    language: w.language ?? null,
    publicationTypes: w.type ? [w.type] : [],
    citationCount: w.cited_by_count ?? null,
    oaUrl: w.open_access?.is_oa ? (w.open_access.oa_url ?? w.best_oa_location?.landing_page_url ?? null) : null,
    oaStatus: w.open_access?.oa_status ?? null,
    license: w.best_oa_location?.license ?? null,
  };
}

type OAList = { meta: { count: number; next_cursor: string | null }; results: OAWork[] };

/**
 * OpenAlex rejects wildcards ("barrier*") in the default stemmed search; they need the unstemmed ".exact" form.
 * Models sometimes write wildcards despite the syntax guide, so switch parameter instead of failing the query.
 */
export function searchParam(query: string) {
  return /\w[*?]/.test(query.replace(/"[^"]*"/g, "")) ? "search.title_abstract_keywords.exact" : "search.title_abstract_keywords";
}

export const openalex: SearchAdapter = {
  name: "openalex",
  label: "OpenAlex",
  syntaxGuide: `OpenAlex works search (sent as search.title_abstract_keywords, matching titles, abstracts and OpenAlex keywords; stemmed). Boolean operators AND/OR/NOT must be UPPERCASE; use parentheses and "double quotes" for phrases. No field tags, no MeSH. Avoid wildcards (if you use one, e.g. barrier*, the whole query is run unstemmed). Keep the whole string under ~1500 characters and use at most ~15 OR terms. Example: ("telemedicine" OR "telehealth" OR "mHealth") AND ("Southeast Asia" OR Thailand OR Vietnam OR Indonesia). Do NOT put year or language limits in the query; they are added from the shared criteria as filters.`,
  async count(query, criteria, log) {
    const p = new URLSearchParams({ [searchParam(query)]: query, filter: openalexFilter(criteria), per_page: "1", select: "id" });
    const j = await httpJson<OAList>("openalex", `${BASE}/works?${p}`, { headers: headers(), log });
    return j.meta.count;
  },
  async search(query, criteria, cap, { log, onPage }) {
    let cursor: string | null = "*";
    const all: SourceRecord[] = [];
    let total = 0;
    while (cursor && all.length < cap) {
      const p = new URLSearchParams({
        [searchParam(query)]: query,
        filter: openalexFilter(criteria),
        per_page: String(Math.min(100, cap - all.length)),
        select: SELECT,
        cursor,
      });
      const j: OAList = await httpJson<OAList>("openalex", `${BASE}/works?${p}`, { headers: headers(), log });
      total = j.meta.count;
      const recs = j.results.map(mapWork).filter((r) => r.title);
      all.push(...recs);
      await onPage?.(recs, total);
      if (!j.results.length) break;
      cursor = j.meta.next_cursor;
    }
    return { total, records: all.slice(0, cap) };
  },
};

/** Batch lookup by DOI (list+filter call, cheap) to fill citation counts / OA links for PubMed records. */
export async function openalexByDois(dois: string[], log?: (l: string) => void): Promise<SourceRecord[]> {
  const out: SourceRecord[] = [];
  for (const batch of chunk(dois, 50)) {
    const p = new URLSearchParams({ filter: `doi:${batch.join("|")}`, per_page: "100", select: SELECT });
    const j = await httpJson<OAList>("openalex", `${BASE}/works?${p}`, { headers: headers(), log });
    out.push(...j.results.map(mapWork));
  }
  return out;
}

export async function openalexByPmids(pmids: string[], log?: (l: string) => void): Promise<SourceRecord[]> {
  const out: SourceRecord[] = [];
  for (const batch of chunk(pmids, 50)) {
    const p = new URLSearchParams({ filter: `pmid:${batch.join("|")}`, per_page: "100", select: SELECT });
    const j = await httpJson<OAList>("openalex", `${BASE}/works?${p}`, { headers: headers(), log });
    out.push(...j.results.map(mapWork));
  }
  return out;
}
