import "server-only";
import { config } from "../config";
import { httpFetch, httpJson } from "./http";
import type { SearchAdapter, SourceRecord } from "./types";
import { hardFilterPubmed } from "./filters";
import { dropEmptyGroups } from "./syntax";
import type { Criteria } from "../db/schema";
import { decodeEntities, normalizeDoi, stripTags, chunk } from "../util";

/*
 * PubMed E-utilities (https://www.ncbi.nlm.nih.gov/books/NBK25497/):
 * - include tool= and email=; max 3 requests/second without an API key (10 with)
 * - esearch for ids/counts, efetch (XML) for records, POST for long id lists
 */
const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function common() {
  const p = new URLSearchParams({ tool: "athena-litreview", email: config.contactEmail });
  if (config.ncbiApiKey) p.set("api_key", config.ncbiApiKey);
  return p;
}

const LANG: Record<string, string> = { en: "english", english: "english", fr: "french", es: "spanish", de: "german", zh: "chinese", ja: "japanese", pt: "portuguese", th: "thai", vi: "vietnamese", id: "indonesian", ms: "malay" };

export function pubmedTerm(query: string, c: Criteria | null) {
  const parts = [`(${dropEmptyGroups(query)})`];
  if (c?.yearFrom || c?.yearTo) parts.push(`("${c?.yearFrom ?? 1900}"[dp] : "${c?.yearTo ?? 3000}"[dp])`);
  const langs = (c?.languages ?? []).map((l) => LANG[l.toLowerCase()] ?? l.toLowerCase()).filter(Boolean);
  if (langs.length) parts.push(`(${langs.map((l) => `${l}[la]`).join(" OR ")})`);
  const hard = hardFilterPubmed(c?.hardFilter);
  if (hard) parts.push(hard);
  return parts.join(" AND ");
}



async function esearch(term: string, retmax: number, retstart: number, log?: (l: string) => void) {
  const p = common();
  p.set("db", "pubmed");
  p.set("term", term);
  p.set("retmode", "json");
  p.set("retmax", String(retmax));
  p.set("retstart", String(retstart));
  p.set("sort", "relevance");
  const j = await httpJson<{ esearchresult?: { count: string; idlist: string[]; ERROR?: string; errorlist?: unknown } ; error?: string }>(
    "pubmed", `${BASE}/esearch.fcgi?${p}`, { log },
  );
  if (!j.esearchresult) throw new Error(`PubMed esearch error: ${j.error ?? "no result"}`);
  if (j.esearchresult.ERROR) throw new Error(`PubMed: ${j.esearchresult.ERROR}`);
  return { count: Number(j.esearchresult.count), ids: j.esearchresult.idlist };
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
}
function tags(block: string, name: string): { attrs: string; body: string }[] {
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "g");
  const out: { attrs: string; body: string }[] = [];
  let m;
  while ((m = re.exec(block))) out.push({ attrs: m[1] ?? "", body: m[2] });
  return out;
}

export function parsePubmedXml(xml: string): SourceRecord[] {
  const recs: SourceRecord[] = [];
  for (const { body: art } of tags(xml, "PubmedArticle")) {
    const pmid = stripTags(tag(art, "PMID") ?? "");
    const title = stripTags(tag(art, "ArticleTitle") ?? tag(art, "VernacularTitle") ?? "");
    const abs = tags(art, "AbstractText")
      .map(({ attrs, body }) => {
        const label = attrs.match(/Label="([^"]+)"/)?.[1];
        const t = stripTags(body);
        return label ? `${decodeEntities(label)}: ${t}` : t;
      })
      .join("\n");
    const authors = tags(art, "Author").map(({ body }) => {
      const last = stripTags(tag(body, "LastName") ?? "");
      const ini = stripTags(tag(body, "Initials") ?? "");
      const coll = stripTags(tag(body, "CollectiveName") ?? "");
      return coll || [last, ini].filter(Boolean).join(" ");
    }).filter(Boolean);
    const journal = stripTags(tag(tag(art, "Journal") ?? "", "Title") ?? "") || null;
    const pubDate = tag(art, "PubDate") ?? "";
    const yearStr = tag(pubDate, "Year") ?? tag(pubDate, "MedlineDate")?.match(/\d{4}/)?.[0] ?? tag(tag(art, "ArticleDate") ?? "", "Year");
    const ids = tags(tag(art, "PubmedData") ?? art, "ArticleId");
    const doi = normalizeDoi(stripTags(ids.find((i) => /IdType="doi"/.test(i.attrs))?.body ?? ""));
    const pmcRaw = stripTags(ids.find((i) => /IdType="pmc"/.test(i.attrs))?.body ?? "");
    const pubTypes = tags(art, "PublicationType").map((t) => stripTags(t.body));
    const lang = stripTags(tag(art, "Language") ?? "") || null;
    if (!pmid || !title) continue;
    recs.push({
      database: "pubmed",
      doi,
      pmid,
      pmcid: pmcRaw ? (pmcRaw.startsWith("PMC") ? pmcRaw : `PMC${pmcRaw}`) : null,
      openalexId: null,
      title,
      authors,
      year: yearStr ? Number(String(yearStr).slice(0, 4)) : null,
      journal,
      abstract: abs || null,
      language: lang,
      publicationTypes: pubTypes,
      citationCount: null,
      oaUrl: pmcRaw ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcRaw.startsWith("PMC") ? pmcRaw : `PMC${pmcRaw}`}/` : null,
      oaStatus: pmcRaw ? "pmc" : null,
      license: null,
    });
  }
  return recs;
}

export async function efetchPubmed(pmids: string[], log?: (l: string) => void): Promise<SourceRecord[]> {
  const out: SourceRecord[] = [];
  for (const ids of chunk(pmids, 100)) {
    const p = common();
    p.set("db", "pubmed");
    p.set("retmode", "xml");
    p.set("id", ids.join(","));
    const r = await httpFetch("pubmed", `${BASE}/efetch.fcgi?${p}`, { log });
    out.push(...parsePubmedXml(r.text));
  }
  return out;
}

export const pubmed: SearchAdapter = {
  name: "pubmed",
  label: "PubMed",
  syntaxGuide: `PubMed (E-utilities esearch "term"). Use field tags: [tiab] title/abstract, [mh] MeSH heading (explodes), [majr] major MeSH topic, [pt] publication type, [tw] text word. Boolean operators AND/OR/NOT in UPPERCASE, parentheses for grouping, quotes for phrases, * for truncation (min 4 chars before *). Example: ("telemedicine"[mh] OR telehealth[tiab] OR "mobile health"[tiab]) AND ("Asia, Southeastern"[mh] OR Thailand[tiab] OR Vietnam[tiab]). Do NOT put year or language limits in the query; they are added from the shared criteria.`,
  async count(query, criteria, log) {
    return (await esearch(pubmedTerm(query, criteria), 0, 0, log)).count;
  },
  async search(query, criteria, cap, { log, onPage }) {
    const term = pubmedTerm(query, criteria);
    const pageSize = Math.min(cap, 100);
    let total = 0;
    const all: SourceRecord[] = [];
    for (let start = 0; start < cap; start += pageSize) {
      const { count, ids } = await esearch(term, Math.min(pageSize, cap - start), start, log);
      total = count;
      if (!ids.length) break;
      const recs = await efetchPubmed(ids, log);
      // Keep esearch relevance order.
      const order = new Map(ids.map((id, i) => [id, i]));
      recs.sort((a, b) => (order.get(a.pmid!) ?? 0) - (order.get(b.pmid!) ?? 0));
      all.push(...recs);
      await onPage?.(recs, total);
      if (start + pageSize >= count) break;
    }
    return { total, records: all };
  },
};
