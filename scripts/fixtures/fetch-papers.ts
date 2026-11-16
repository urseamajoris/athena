// One-off fetcher for the fixture's real records. Test tooling only: never imported by the app, and
// scripts/seed-fixture.ts never needs the network (it reads the files this script wrote).
//
//   NODE_USE_ENV_PROXY=1 npx tsx --conditions=react-server scripts/fixtures/fetch-papers.ts papers
//   NODE_USE_ENV_PROXY=1 npx tsx --conditions=react-server scripts/fixtures/fetch-papers.ts fulltext PMC1234567 PMC2345678
//   NODE_USE_ENV_PROXY=1 npx tsx --conditions=react-server scripts/fixtures/fetch-papers.ts novelty
//
// (--conditions=react-server makes the app's `server-only` guard a no-op, so the app's own parsers are used and a
// record here is exactly what the app would have stored. NODE_USE_ENV_PROXY=1 is only needed behind an HTTPS proxy.)
//
// papers    Runs each topic's PubMed query from plan.ts (same term and relevance order as the app's PubMed
//           adapter), fetches the records, then looks each one up in OpenAlex by PMID (single-record lookups,
//           which are free) and in Europe PMC (licence). Writes papers.json.
// fulltext  Fetches the open-access full text of the given PMC IDs from Europe PMC (fullTextXML, open-access
//           subset only), converts it with the app's JATS parser and keeps the first few thousand characters.
//           Writes fulltext/<PMCID>.json with the licence.
// novelty   Runs the PubMed novelty query of each research question in evidence.ts and stores the top records.
//
// Only free services are called: PubMed E-utilities (tool=athena-fixture, at most 3 requests a second), OpenAlex
// single-record lookups without a key, and Europe PMC. The OpenAlex search API is never called (it is metered), so
// papers.json holds no OpenAlex search results: see `openalexNote` in the file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CAP, CRITERIA, EXTRA, TOPICS } from "./plan";
import type { SourceRecord } from "../../src/lib/sources/types";
import { normalizeTitle } from "../../src/lib/util";

const DIR = __dirname;
const OUT = path.join(DIR, "papers.json");
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const NCBI = "tool=athena-fixture&email=athena-fixture%40example.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let last = 0;
/** GET with at least `gap` ms between requests and a few retries on 429/5xx. */
async function get(url: string, gap = 400, okStatuses = [200]): Promise<{ status: number; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": "athena-fixture/1.0" }, signal: AbortSignal.timeout(45000) });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (!okStatuses.includes(res.status)) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}: ${text.slice(0, 200)}`);
    return { status: res.status, text };
  }
}

export interface FixturePaper {
  pubmed: SourceRecord;
  /** The same work as OpenAlex returns it (single-record lookup by PMID), or null if OpenAlex does not have it. */
  openalex: SourceRecord | null;
  europepmc: { pmcid: string | null; license: string | null; isOpenAccess: boolean } | null;
}
export interface FixtureSearch {
  term: string;
  total: number;
  /** PMIDs in PubMed's relevance order: the first CAP are the topic's PubMed search, the rest go to its OpenAlex search. */
  pmids: string[];
}
export interface NoveltyResult {
  query: string;
  total: number;
  records: { title: string; year: number | null; doi: string | null; pmid: string | null; openalexId: string | null }[];
}
export interface FixtureFile {
  about: string;
  openalexNote: string;
  fetchedAt: string;
  cap: number;
  extra: number;
  searches: Record<string, FixtureSearch>;
  papers: Record<string, FixturePaper>;
  novelty: Record<string, NoveltyResult>;
}

async function app() {
  // The app's source modules open the database when imported: point them at a throwaway file.
  process.env.DATABASE_PATH ||= path.join(os.tmpdir(), "athena-fixture-fetch.db");
  const { pubmedTerm, parsePubmedXml } = await import("../../src/lib/sources/pubmed");
  const { mapWork } = await import("../../src/lib/sources/openalex");
  const { jatsToText } = await import("../../src/lib/sources/europepmc");
  return { pubmedTerm, parsePubmedXml, mapWork, jatsToText };
}

async function esearch(term: string, retmax: number) {
  const p = new URLSearchParams({ db: "pubmed", term, retmode: "json", retmax: String(retmax), retstart: "0", sort: "relevance" });
  const j = JSON.parse((await get(`${EUTILS}/esearch.fcgi?${NCBI}&${p}`)).text) as { esearchresult: { count: string; idlist: string[] } };
  return { total: Number(j.esearchresult.count), pmids: j.esearchresult.idlist };
}

async function efetch(pmids: string[], parse: (xml: string) => SourceRecord[]) {
  const out: SourceRecord[] = [];
  for (let i = 0; i < pmids.length; i += 80) {
    const p = new URLSearchParams({ db: "pubmed", retmode: "xml", id: pmids.slice(i, i + 80).join(",") });
    out.push(...parse((await get(`${EUTILS}/efetch.fcgi?${NCBI}&${p}`)).text));
  }
  return out;
}

const OA_SELECT = "id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,abstract_inverted_index,cited_by_count,open_access,ids,language,type";

async function fetchPapers() {
  const { pubmedTerm, parsePubmedXml, mapWork } = await app();
  const searches: FixtureFile["searches"] = {};
  for (const t of TOPICS) {
    const term = pubmedTerm(t.pubmed.query, CRITERIA);
    const r = await esearch(term, CAP + EXTRA);
    searches[t.key] = { term, total: r.total, pmids: r.pmids };
    console.log(`${t.key}: ${r.total} hits, kept ${r.pmids.length}`);
  }
  const all = [...new Set(Object.values(searches).flatMap((s) => s.pmids))];
  const recs = await efetch(all, parsePubmedXml);
  console.log(`PubMed: ${recs.length} of ${all.length} records parsed`);
  const papers: FixtureFile["papers"] = {};
  for (const r of recs) {
    // OpenAlex sometimes files a PMID under the wrong work: a record is kept only when its title is this paper's.
    let openalex: SourceRecord | null = null;
    for (const key of [`pmid:${r.pmid}`, r.doi ? `doi:${r.doi}` : null]) {
      if (!key || openalex) continue;
      const oa = await get(`https://api.openalex.org/works/${key}?select=${OA_SELECT}`, 250, [200, 404]);
      const rec = oa.status === 200 ? mapWork(JSON.parse(oa.text)) : null;
      if (rec && normalizeTitle(rec.title) === normalizeTitle(r.title)) openalex = rec;
    }
    let europepmc: FixturePaper["europepmc"] = null;
    const q = new URLSearchParams({ query: `EXT_ID:${r.pmid} AND SRC:MED`, format: "json", resultType: "core", pageSize: "1" });
    const e = JSON.parse((await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${q}`, 200)).text) as { resultList?: { result?: { pmcid?: string; license?: string; isOpenAccess?: string }[] } };
    const hit = e.resultList?.result?.[0];
    if (hit) europepmc = { pmcid: hit.pmcid ?? null, license: hit.license ?? null, isOpenAccess: hit.isOpenAccess === "Y" };
    papers[r.pmid!] = { pubmed: r, openalex, europepmc };
    process.stdout.write(".");
  }
  console.log();
  const prev: Partial<FixtureFile> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const file: FixtureFile = {
    about:
      "Real bibliographic records for the Athena test fixtures (scripts/seed-fixture.ts). `searches` holds each topic's PubMed search exactly as run (term, total hits, PMIDs in relevance order); `papers` holds every record as PubMed returned it, the same work as OpenAlex returns it, and its Europe PMC licence. Nothing here was written by a model.",
    openalexNote:
      "The OpenAlex search API was not called (it is metered and no key may be used for fixtures). Each record's OpenAlex data comes from a free single-record lookup by PMID. The seeding script files the PubMed records ranked after the cap under the topic's OpenAlex search, so the hit counts and ranks of OpenAlex searches in a seeded review are fixture values, not OpenAlex results.",
    fetchedAt: new Date().toISOString().slice(0, 10),
    cap: CAP,
    extra: EXTRA,
    searches,
    papers,
    novelty: prev.novelty ?? {},
  };
  fs.writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
  console.log(`Wrote ${Object.keys(papers).length} papers to ${path.relative(process.cwd(), OUT)}`);
}

/** Characters of each full text kept in the fixture (cut at the end of a paragraph). */
const FULLTEXT_CHARS = 6000;

async function fetchFullText(pmcids: string[]) {
  const { jatsToText } = await app();
  const file = JSON.parse(fs.readFileSync(OUT, "utf8")) as FixtureFile;
  fs.mkdirSync(path.join(DIR, "fulltext"), { recursive: true });
  for (const pmcid of pmcids) {
    const paper = Object.values(file.papers).find((p) => p.pubmed.pmcid === pmcid);
    if (!paper) throw new Error(`${pmcid} is not a paper in papers.json`);
    const license = paper.europepmc?.license ?? null;
    if (!paper.europepmc?.isOpenAccess || !license || !/^cc[ -]?(by|0)/i.test(license)) throw new Error(`${pmcid}: not an openly licensed article (licence: ${license ?? "none"})`);
    const r = await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`, 300);
    const full = jatsToText(r.text);
    let cut = full.text.lastIndexOf("\n", FULLTEXT_CHARS);
    if (cut < FULLTEXT_CHARS / 2) cut = FULLTEXT_CHARS;
    const text = full.text.slice(0, cut).trimEnd();
    const out = {
      about: "Start of an open-access article's full text, from Europe PMC (fullTextXML), converted to plain text by the app's JATS parser and cut at the end of a paragraph. Used as the stored source text of a fixture article.",
      pmcid,
      pmid: paper.pubmed.pmid,
      title: paper.pubmed.title,
      license,
      url: `https://europepmc.org/article/PMC/${pmcid}`,
      fetchedAt: new Date().toISOString().slice(0, 10),
      originalLength: full.text.length,
      text,
      sections: full.sections.filter((s) => s.start < text.length),
    };
    fs.writeFileSync(path.join(DIR, "fulltext", `${pmcid}.json`), JSON.stringify(out, null, 1) + "\n");
    console.log(`${pmcid}: kept ${text.length} of ${full.text.length} characters (${license}), ${out.sections.length} sections`);
  }
}

async function fetchNovelty() {
  const { pubmedTerm, parsePubmedXml, mapWork } = await app();
  const { QUESTIONS } = await import("./evidence");
  const file = JSON.parse(fs.readFileSync(OUT, "utf8")) as FixtureFile;
  file.novelty = {};
  for (const q of QUESTIONS) {
    const r = await esearch(pubmedTerm(q.noveltyQueries.pubmed, CRITERIA), 8);
    const recs = await efetch(r.pmids, parsePubmedXml);
    const order = new Map(r.pmids.map((id, i) => [id, i]));
    recs.sort((a, b) => (order.get(a.pmid!) ?? 0) - (order.get(b.pmid!) ?? 0));
    const records: NoveltyResult["records"] = [];
    for (const rec of recs) {
      const oa = await get(`https://api.openalex.org/works/pmid:${rec.pmid}?select=${OA_SELECT}`, 250, [200, 404]);
      records.push({ title: rec.title, year: rec.year, doi: rec.doi, pmid: rec.pmid, openalexId: oa.status === 200 ? mapWork(JSON.parse(oa.text)).openalexId : null });
    }
    file.novelty[q.key] = { query: q.noveltyQueries.pubmed, total: r.total, records };
    console.log(`${q.key}: ${r.total} hits, kept ${records.length}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "papers") await fetchPapers();
  else if (cmd === "fulltext" && rest.length) await fetchFullText(rest);
  else if (cmd === "novelty") await fetchNovelty();
  else {
    console.error("Usage: fetch-papers.ts papers | fulltext <PMCID>... | novelty");
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
