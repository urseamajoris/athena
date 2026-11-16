// The parts of the report that state the research question and each article's reading against it, as pure
// functions over plain data (unit-tested in report-parts.test.ts). export.ts reads the database and assembles
// the whole report from these and its own sections.
import { RELEVANCE_LABEL, type Relevance } from "./shared/stages";
import type { WorkingQuestion } from "./stages/rules";

/** "## Research question": the working question with its framework parts, and whether it was confirmed. */
export function questionSection(q: WorkingQuestion | null, confirmedAt: string | null): string[] {
  if (!q) return ["No research question has been set yet. The review so far rests on the research idea above.", ""];
  const L = [`**${q.text}**`, ""];
  if (q.framework) L.push(`Framework: ${q.framework}`, "");
  const parts = Object.entries(q.structure ?? {});
  for (const [k, v] of parts) L.push(`- **${k}:** ${v}`);
  if (parts.length) L.push("");
  L.push(
    confirmedAt
      ? `_This is the working research question, confirmed on ${confirmedAt.slice(0, 10)} before the search. The searches, the ranking of papers, the analysis of each article and the evidence summary were all judged against it._`
      : "_This is the working research question. It has not been confirmed yet._",
    "",
  );
  return L;
}

export interface FinalQuestion {
  text: string;
  /** "working": the working question offered unchanged; "revision": proposed from the evidence. */
  kind: "working" | "revision";
  /** The user changed the wording after it was offered. */
  edited: boolean;
  /** For a revision: what the evidence shows is missing and how the wording differs from the working question. */
  gap: string;
}

/** How the final question relates to the working one, in plain sentences (the first lines under "Final question"). */
export function finalQuestionDifference(working: WorkingQuestion | null, chosen: FinalQuestion): string[] {
  const same = !!working && working.text.trim() === chosen.text.trim();
  if (chosen.kind === "working") {
    if (same || !chosen.edited) return ["You kept your working research question unchanged after reading the evidence."];
    return [`You kept your working research question and reworded it after reading the evidence. Before: “${working?.text ?? "not recorded"}”`];
  }
  const L: string[] = [];
  L.push(working ? `This is a revision of the working research question (“${working.text}”), proposed from the evidence${chosen.edited ? " and then edited by you" : ""}.` : `This question was proposed from the evidence${chosen.edited ? " and then edited by you" : ""}; the review had no working research question.`);
  if (chosen.gap.trim()) L.push(`**What the evidence shows is missing, and how this wording differs:** ${chosen.gap.trim()}`);
  return L;
}

export const relevanceLabel = (r: string): string => RELEVANCE_LABEL[r as Relevance] ?? "";

/** The first lines of an article's analysis: its bottom line and how it bears on the research question. */
export function analysisSummaryLines(a: { bottomLine: string; relevance: string; relevanceNote: string }): string[] {
  const L: string[] = [];
  if (a.bottomLine.trim()) L.push(`**Bottom line:** ${a.bottomLine.trim()}`, "");
  const label = relevanceLabel(a.relevance);
  if (label) L.push(`**Relevance to the research question:** ${label}${a.relevanceNote.trim() ? `. ${a.relevanceNote.trim()}` : ""}`, "");
  return L;
}

export const ANALYSIS_CSV_HEAD = ["bottom_line (article analysis)", "relevance_to_question (article analysis)", "relevance_note (article analysis)"];

/** The spreadsheet's article-analysis cells: empty where a paper has no finished analysis. */
export function analysisCsvCells(a: { status: string; bottomLine: string; relevance: string; relevanceNote: string } | null | undefined): string[] {
  if (!a || a.status !== "done") return ["", "", ""];
  return [a.bottomLine, a.relevance, a.relevanceNote];
}
