/*
 * Test-only network. Production has no HTTP fixture replay any more (removed in #7), so without this the unit tests
 * would call PubMed, OpenAlex, Crossref, Unpaywall and Europe PMC for real: slow, non-deterministic, and outbound.
 * Installed by ./env: literature-API requests get small synthetic answers; any other request fails at once.
 *
 * - PubMed esearch: 2 PMIDs per query term (derived from the term, so different queries find different records);
 *   efetch: a journal article per PMID with a usable abstract, a DOI and no PMC copy.
 * - OpenAlex, Crossref search, Europe PMC search: no results. Crossref DOI lookup, Unpaywall, Europe PMC full text: 404.
 */
import { createHash } from "node:crypto";

const ABSTRACT =
  "BACKGROUND: Telemedicine use in Southeast Asia grew quickly. METHODS: We surveyed rural clinics in Thailand between 2019 and 2021. " +
  "RESULTS: Uptake of teleconsultation rose in rural districts, but clinicians reported that poor connectivity limited video visits. " +
  "CONCLUSIONS: Infrastructure investment is needed before telemedicine can be scaled in remote provinces.";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });

function pmidsFor(term: string): string[] {
  const h = parseInt(createHash("sha256").update(term).digest("hex").slice(0, 6), 16);
  const base = 39_000_000 + (h % 900_000) * 2;
  return [String(base), String(base + 1)];
}

function pubmedXml(ids: string[]): string {
  const arts = ids.map(
    (id) => `<PubmedArticle><MedlineCitation><PMID>${id}</PMID><Article><Journal><Title>Journal of Test Telemedicine</Title><JournalIssue><PubDate><Year>2021</Year></PubDate></JournalIssue></Journal>` +
      `<ArticleTitle>Teleconsultation in rural Thailand: test record ${id}</ArticleTitle><Abstract><AbstractText>${ABSTRACT}</AbstractText></Abstract>` +
      `<AuthorList><Author><LastName>Tester</LastName><Initials>T</Initials></Author></AuthorList><Language>eng</Language>` +
      `<PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList></Article></MedlineCitation>` +
      `<PubmedData><ArticleIdList><ArticleId IdType="pubmed">${id}</ArticleId><ArticleId IdType="doi">10.5555/test.${id}</ArticleId></ArticleIdList></PubmedData></PubmedArticle>`,
  );
  return `<?xml version="1.0"?><PubmedArticleSet>${arts.join("")}</PubmedArticleSet>`;
}

export function fakeFetchResponse(rawUrl: string): Response {
  const url = new URL(rawUrl);
  const host = url.hostname;
  if (host === "eutils.ncbi.nlm.nih.gov") {
    if (url.pathname.endsWith("/esearch.fcgi")) {
      const ids = pmidsFor(url.searchParams.get("term") ?? "");
      const retmax = Number(url.searchParams.get("retmax") ?? "20");
      const retstart = Number(url.searchParams.get("retstart") ?? "0");
      return json({ esearchresult: { count: String(ids.length), idlist: ids.slice(retstart, retstart + retmax) } });
    }
    if (url.pathname.endsWith("/efetch.fcgi")) {
      const ids = (url.searchParams.get("id") ?? "").split(",").filter(Boolean);
      return new Response(pubmedXml(ids), { status: 200, headers: { "content-type": "text/xml" } });
    }
  }
  if (host === "api.openalex.org") return json({ meta: { count: 0, next_cursor: null }, results: [] });
  if (host === "api.crossref.org") return url.pathname === "/works" ? json({ message: { items: [] } }) : notFound();
  if (host === "api.unpaywall.org") return notFound();
  if (host === "www.ebi.ac.uk") return url.pathname.endsWith("/search") ? json({ resultList: { result: [] } }) : notFound();
  throw new Error(`fake fetch (tests): no network in unit tests (${host})`);
}

export function installFakeFetch() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return fakeFetchResponse(url);
  }) as typeof fetch;
}
