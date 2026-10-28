import "server-only";
import { httpFetch, httpJson } from "./http";
import { decodeEntities } from "../util";

/*
 * Europe PMC REST (https://europepmc.org/RestfulWebService): no key. fullTextXML is served only for the
 * open-access subset, so a 200 here means the text is openly available. Licence comes from the core search result.
 */
const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest";

export async function europePmcLookup(opts: { pmcid?: string | null; doi?: string | null; pmid?: string | null }, log?: (l: string) => void) {
  const q = opts.pmcid ? `PMCID:${opts.pmcid}` : opts.doi ? `DOI:"${opts.doi}"` : opts.pmid ? `EXT_ID:${opts.pmid} AND SRC:MED` : null;
  if (!q) return null;
  const p = new URLSearchParams({ query: q, format: "json", resultType: "core", pageSize: "1" });
  const j = await httpJson<{ resultList?: { result?: { pmcid?: string; license?: string; isOpenAccess?: string; inEPMC?: string }[] } }>("europepmc", `${BASE}/search?${p}`, { log });
  const r = j.resultList?.result?.[0];
  if (!r) return null;
  return { pmcid: r.pmcid ?? null, license: r.license ?? null, isOpenAccess: r.isOpenAccess === "Y", inEPMC: r.inEPMC === "Y" };
}

export interface ParsedFullText {
  text: string;
  sections: { title: string; start: number }[];
}

/** Convert JATS XML into plain text with section markers. References, tables and figures' internals are dropped. */
export function jatsToText(xml: string): ParsedFullText {
  let body = xml;
  const title = xml.match(/<article-title[^>]*>([\s\S]*?)<\/article-title>/)?.[1] ?? "";
  const abstract = xml.match(/<abstract(?:\s[^>]*)?>([\s\S]*?)<\/abstract>/)?.[1] ?? "";
  const bodyM = xml.match(/<body[^>]*>([\s\S]*)<\/body>/);
  body = bodyM ? bodyM[1] : "";
  const clean = (s: string) =>
    s
      .replace(/<ref-list[\s\S]*?<\/ref-list>/g, "")
      .replace(/<table-wrap[\s\S]*?<\/table-wrap>/g, (m) => {
        const cap = m.match(/<caption[^>]*>([\s\S]*?)<\/caption>/)?.[1];
        return cap ? `\n[Table] ${cap}\n` : "";
      })
      .replace(/<fig[\s\S]*?<\/fig>/g, (m) => {
        const cap = m.match(/<caption[^>]*>([\s\S]*?)<\/caption>/)?.[1];
        return cap ? `\n[Figure] ${cap}\n` : "";
      })
      .replace(/<xref[^>]*>[\s\S]*?<\/xref>/g, "")
      .replace(/<sec[^>]*>\s*<title[^>]*>([\s\S]*?)<\/title>/g, (_, t) => `\n\n§§${t.replace(/<[^>]+>/g, "")}§§\n`)
      .replace(/<title[^>]*>([\s\S]*?)<\/title>/g, "\n$1\n")
      .replace(/<\/p>/g, "\n")
      .replace(/<[^>]+>/g, "");
  let raw = "";
  if (title) raw += `§§Title§§\n${clean(title)}\n`;
  if (abstract) raw += `\n§§Abstract§§\n${clean(abstract.replace(/^\s*<title[^>]*>\s*abstract\s*<\/title>/i, ""))}\n`;
  raw += clean(body);
  raw = decodeEntities(raw).replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n");
  const sections: { title: string; start: number }[] = [];
  let text = "";
  const parts = raw.split(/§§([^§]*)§§/);
  // parts: [pre, title1, content1, title2, content2, ...]
  text += parts[0].trim() ? parts[0].trim() + "\n\n" : "";
  for (let i = 1; i < parts.length; i += 2) {
    const t = parts[i].trim() || "Section";
    sections.push({ title: t, start: text.length });
    text += `${t.toUpperCase()}\n${(parts[i + 1] ?? "").trim()}\n\n`;
  }
  return { text: text.trim(), sections };
}

export async function europePmcFullText(pmcid: string, log?: (l: string) => void): Promise<ParsedFullText | null> {
  const r = await httpFetch("europepmc", `${BASE}/${pmcid}/fullTextXML`, { log, okStatuses: [404] });
  if (r.status !== 200 || !r.text.includes("<body")) return null;
  const parsed = jatsToText(r.text);
  return parsed.text.length > 500 ? parsed : null;
}
