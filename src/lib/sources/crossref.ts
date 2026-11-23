import "server-only";
import { config } from "../config";
import { httpJson } from "./http";
import { normalizeDoi, normalizeTitle, stripTags } from "../util";
import { usableAbstract } from "./abstract";

/*
 * Crossref REST API (https://api.crossref.org): polite pool via mailto=, used only to fill DOI/metadata gaps.
 */
const BASE = "https://api.crossref.org";

interface CRItem {
  DOI: string;
  title?: string[];
  "container-title"?: string[];
  issued?: { "date-parts"?: number[][] };
  author?: { family?: string; given?: string; name?: string }[];
  abstract?: string;
  "is-referenced-by-count"?: number;
}

export interface CrossrefMeta {
  doi: string;
  title: string;
  journal: string | null;
  year: number | null;
  authors: string[];
  abstract: string | null;
  citationCount: number | null;
}

function map(i: CRItem): CrossrefMeta {
  return {
    doi: normalizeDoi(i.DOI)!,
    title: stripTags(i.title?.[0] ?? ""),
    journal: i["container-title"]?.[0] ?? null,
    year: i.issued?.["date-parts"]?.[0]?.[0] ?? null,
    authors: (i.author ?? []).map((a) => a.name ?? [a.family, a.given?.[0]].filter(Boolean).join(" ")).filter(Boolean),
    abstract: i.abstract ? usableAbstract(stripTags(i.abstract)) : null,
    citationCount: i["is-referenced-by-count"] ?? null,
  };
}

/** Find a DOI for a title. Only accepts an exact normalised-title match, never a fuzzy guess. */
export async function crossrefFindByTitle(title: string, year: number | null, log?: (l: string) => void): Promise<CrossrefMeta | null> {
  const p = new URLSearchParams({
    "query.bibliographic": title.slice(0, 300),
    rows: "3",
    select: "DOI,title,container-title,issued,author,is-referenced-by-count",
    mailto: config.contactEmail,
  });
  const j = await httpJson<{ message: { items: CRItem[] } }>("crossref", `${BASE}/works?${p}`, { log });
  const want = normalizeTitle(title);
  for (const it of j.message.items ?? []) {
    const m = map(it);
    if (normalizeTitle(m.title) === want && (!year || !m.year || Math.abs(m.year - year) <= 1)) return m;
  }
  return null;
}

export async function crossrefByDoi(doi: string, log?: (l: string) => void): Promise<CrossrefMeta | null> {
  const p = new URLSearchParams({ mailto: config.contactEmail });
  const j = await httpJson<{ message: CRItem }>("crossref", `${BASE}/works/${encodeURIComponent(doi)}?${p}`, { log, okStatuses: [404] }).catch(() => null);
  return j?.message?.DOI ? map(j.message) : null;
}
