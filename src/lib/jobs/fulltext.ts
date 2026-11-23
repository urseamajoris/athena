import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { europePmcFullText, europePmcLookup } from "../sources/europepmc";
import { unpaywall } from "../sources/unpaywall";
import { httpFetch } from "../sources/http";
import { newId, errMsg } from "../util";
import { fullTextSourceNote } from "../appraisal-text";

type Paper = typeof schema.papers.$inferSelect;

/** Licences we treat as openly reusable (so the derived text may be stored locally). */
export function isOpenLicense(l: string | null | undefined): boolean {
  if (!l) return false;
  return /^(cc[-_ ]?by|cc0|public[-_ ]domain|pd)/i.test(l.replace(/^https?:\/\/creativecommons\.org\/licenses\//i, "cc-"));
}

export interface TextResult {
  sourceTextId: string;
  kind: "full_text" | "abstract";
  source: string;
  note: string;
}

/**
 * Fetch text for appraisal, only where it is legally open:
 *  1. Europe PMC full text (PMC open-access subset; Europe PMC only serves fullTextXML for OA articles)
 *  2. Unpaywall best OA location with a CC licence → PDF text extracted in memory (the PDF itself is never stored)
 *  3. otherwise the abstract, labelled abstract-only
 */
export async function getAppraisalText(paper: Paper, log: (l: string) => void): Promise<TextResult> {
  const existing = db.select().from(schema.sourceTexts).where(eq(schema.sourceTexts.paperId, paper.id)).all();
  const ft = existing.find((e) => e.kind === "full_text");
  if (ft) return { sourceTextId: ft.id, kind: "full_text", source: ft.source, note: fullTextSourceNote(ft.source, ft.license, paper.pmcid) };

  const reasons: string[] = [];
  // 1. Europe PMC / PMC
  try {
    let pmcid = paper.pmcid;
    let license: string | null = null;
    const look = await europePmcLookup({ pmcid, doi: paper.doi, pmid: paper.pmid }, log);
    if (look) {
      pmcid = pmcid ?? look.pmcid;
      license = look.license;
    }
    if (pmcid) {
      const t = await europePmcFullText(pmcid, log);
      if (t) {
        const id = newId("st");
        const lic = license ?? "PMC open-access subset";
        db.insert(schema.sourceTexts).values({ id, paperId: paper.id, kind: "full_text", source: "europepmc", license: lic, url: `https://europepmc.org/article/PMC/${pmcid}`, text: t.text, sections: t.sections, fullLength: t.text.length }).run();
        if (!paper.pmcid) db.update(schema.papers).set({ pmcid }).where(eq(schema.papers.id, paper.id)).run();
        return { sourceTextId: id, kind: "full_text", source: "europepmc", note: fullTextSourceNote("europepmc", lic, pmcid) };
      }
      reasons.push(`${pmcid} has no open full text in Europe PMC`);
    } else reasons.push("not in PubMed Central");
  } catch (e) {
    reasons.push(`Europe PMC failed: ${errMsg(e)}`);
  }

  // 2. Unpaywall CC-licensed PDF
  if (paper.doi) {
    try {
      const u = await unpaywall(paper.doi, log);
      if (u?.pdfUrl && isOpenLicense(u.license)) {
        const r = await httpFetch("pdf", u.pdfUrl, { binary: true, maxRetries: 1 });
        const ct = r.contentType ?? "";
        if (!/pdf/i.test(ct) && !/^JVBER/.test(r.text)) throw new Error(`OA link did not return a PDF (${ct || "unknown type"})`);
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(r.text, "base64")));
        const { text } = await extractText(pdf, { mergePages: false });
        const pages = Array.isArray(text) ? text : [text];
        let full = "";
        const sections: { title: string; start: number }[] = [];
        pages.forEach((pg, i) => {
          sections.push({ title: `Page ${i + 1}`, start: full.length });
          full += `${pg.replace(/[ \t]+/g, " ").trim()}\n\n`;
        });
        if (full.trim().length > 1500) {
          const id = newId("st");
          db.insert(schema.sourceTexts).values({ id, paperId: paper.id, kind: "full_text", source: "unpaywall_pdf", license: u.license, url: u.pdfUrl, text: full.trim(), sections, fullLength: full.trim().length }).run();
          return { sourceTextId: id, kind: "full_text", source: "unpaywall_pdf", note: fullTextSourceNote("unpaywall_pdf", u.license) };
        }
        reasons.push("open PDF had too little extractable text");
      } else if (u?.isOa) {
        reasons.push(`open-access copy exists but licence is ${u.license ?? "not stated"}, so it is not used`);
      } else reasons.push("no open-access copy found by Unpaywall");
    } catch (e) {
      reasons.push(`Unpaywall/PDF failed: ${errMsg(e)}`);
    }
  } else reasons.push("no DOI for an Unpaywall lookup");

  // 3. Abstract fallback
  const abs = existing.find((e) => e.kind === "abstract");
  const note = `Full text was not legally available: ${reasons.join("; ")}.`;
  if (abs) return { sourceTextId: abs.id, kind: "abstract", source: abs.source, note };
  const text = `TITLE\n${paper.title}\n\nABSTRACT\n${paper.abstract ?? "(no abstract available)"}`;
  const id = newId("st");
  const src = paper.sourceDatabases[0] ?? "database";
  db.insert(schema.sourceTexts).values({ id, paperId: paper.id, kind: "abstract", source: src, text, sections: [{ title: "Title", start: 0 }, { title: "Abstract", start: text.indexOf("ABSTRACT") }], fullLength: text.length }).run();
  return { sourceTextId: id, kind: "abstract", source: src, note };
}
