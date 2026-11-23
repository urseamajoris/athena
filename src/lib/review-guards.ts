import {
  detectCriteriaFlags,
  formatCriteriaGuidance,
  hasNonStudyFlag,
  shouldAvoidAutoSelect,
  type CriteriaLike,
  type PaperFlag,
} from "./shared/criteria";
import {
  complementRanges,
  fullTextSourceLabel,
  isSpanWithinSentRanges,
  mapSentSpanToOriginal,
  reconstructSentText,
  type AppraisalInput,
  type TextRange,
  type TextSection,
} from "./appraisal-text";
import { closestPassage, normalizeWithMap, sectionAt, verifyQuote } from "./quotes";
import { CHECKLISTS, FIELD_GUIDANCE, TEMPLATE_LABEL, type TemplateType } from "./stages/templates";
import { EXTRACTION_FIELDS } from "./stages/ai-schemas";

/** Wrap retrieved/untrusted text so the model treats it as data. */
export function wrapUntrustedData(label: string, content: string): string {
  const safe = content.replace(/<<<|>>>/g, "« »");
  return `<<<BEGIN DATA: ${label}>>>\n${safe}\n<<<END DATA: ${label}>>>`;
}

export interface RankingPaperInput {
  id: string;
  title: string;
  year: number | null;
  abstract: string | null;
  publicationTypes?: string[] | null;
  oaStatus?: string | null;
  excluded?: boolean | null;
}

export interface RankingSummaryInput {
  studyType: string;
  setting: string;
  keyFinding: string;
}

/**
 * Build prompt variables for the ranking prompt, including the researcher's inclusion,
 * exclusion, and study-type criteria as guidance and publication-type/criteria flags.
 */
export function buildRankingPromptVars(opts: {
  idea: string;
  scopingSummary: Record<string, string> | null;
  criteria: CriteriaLike | null;
  topic: { name: string; rationale: string };
  batch: RankingPaperInput[];
  summaries: Map<string, RankingSummaryInput>;
}): Record<string, string> {
  const criteriaText = formatCriteriaGuidance(opts.criteria);
  return {
    idea: wrapUntrustedData("research idea", opts.idea),
    summary: wrapUntrustedData("scoping summary", JSON.stringify(opts.scopingSummary ?? {})),
    criteria: wrapUntrustedData("review criteria", criteriaText),
    topic: `${opts.topic.name} — ${opts.topic.rationale}`,
    papers: opts.batch
      .map((x) => {
        const s = opts.summaries.get(x.id);
        const flags = detectCriteriaFlags(x, s, opts.criteria);
        const flagLine = flags.length ? `\nCriteria/type flags: ${flags.map((f) => `${f.label} (${f.reason})`).join("; ")}` : "";
        return wrapUntrustedData(
          `paper ${x.id}`,
          `ID: ${x.id}\nTitle: ${x.title}\nYear: ${x.year ?? "n/a"}\nPublication types: ${(x.publicationTypes ?? []).join(", ") || "n/a"}\nStudy type (from abstract): ${s?.studyType ?? "n/a"}\nSetting (from abstract): ${s?.setting ?? "n/a"}\nKey finding (from abstract): ${s?.keyFinding ?? "n/a"}${flagLine}\nAbstract excerpt: ${(x.abstract ?? "none").slice(0, 700)}`,
        );
      })
      .join("\n\n"),
  };
}

/**
 * Choose which scored papers in a topic should be pre-selected.
 * Excluded papers and papers flagged by criteria or publication type (protocol, editorial,
 * letter, comment, erratum, or stored exclusion) are NOT silently pre-selected.
 */
export function selectInitialRankingIds(
  topicScores: { id: string; paperId: string; total: number }[],
  paperFlagsById: Map<string, { flags: PaperFlag[]; excluded: boolean }>,
  limit: number,
): string[] {
  return [...topicScores]
    .filter((s) => {
      const info = paperFlagsById.get(s.paperId);
      if (!info) return true;
      return !shouldAvoidAutoSelect(info.flags, info.excluded);
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((s) => s.id);
}

/**
 * Build prompt variables for the appraisal prompt, including the researcher's inclusion,
 * exclusion, and study-type criteria as guidance and honest text provenance/truncation notes.
 */
export function buildAppraisalPromptVars(opts: {
  criteria: CriteriaLike | null;
  paper: { id: string; title: string; year: number | null; publicationTypes?: string[] | null };
  template: TemplateType;
  textSourceKind: "full_text" | "abstract";
  sourceOrigin: string | null | undefined;
  input: AppraisalInput;
  sourceNote: string;
}): Record<string, string> {
  const checklist = CHECKLISTS[opts.template];
  const guidance = FIELD_GUIDANCE[opts.template];
  const textSource =
    opts.textSourceKind === "full_text"
      ? fullTextSourceLabel("full_text", opts.sourceOrigin, opts.input.truncated).toUpperCase()
      : "ABSTRACT ONLY (the full text was not available; do not imply you read it)";
  const noteParts = [opts.sourceNote, opts.input.note].filter(Boolean);
  return {
    textSource,
    textNote: noteParts.join(" "),
    criteria: wrapUntrustedData("review criteria", formatCriteriaGuidance(opts.criteria)),
    template: TEMPLATE_LABEL[opts.template],
    fields: EXTRACTION_FIELDS.map((f) => `- ${f}: ${guidance[f]}`).join("\n"),
    checklist: checklist.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    paperId: opts.paper.id,
    title: opts.paper.title,
    year: String(opts.paper.year ?? "n/a"),
    text: wrapUntrustedData(`source text of ${opts.paper.id}`, opts.input.text),
  };
}

/**
 * Verify a quote strictly against the text ranges actually sent to the model, mapping verified
 * offsets back to the full stored source text so highlights align accurately in the source pane.
 */
export function verifyQuoteInSentRanges(
  fullText: string,
  sections: TextSection[],
  sentRanges: TextRange[],
  quote: string,
  preSent?: ReturnType<typeof normalizeWithMap>,
) {
  const sentText = reconstructSentText(fullText, sentRanges);
  const r = verifyQuote(sentText, quote, preSent);
  if (r.verified && r.start !== null && r.end !== null) {
    const mapped = mapSentSpanToOriginal(r.start, r.end, fullText, sentRanges);
    if (mapped) {
      const sec = sectionAt(sections, mapped.start);
      return {
        verified: true,
        matchStart: mapped.start,
        matchEnd: mapped.end,
        verificationNote: `${r.note}${sec ? ` Found in: ${sec}.` : ""}`,
      };
    }
    return {
      verified: false,
      matchStart: null,
      matchEnd: null,
      verificationNote: "UNVERIFIED: Quote spans across an omitted region that was not sent to the model.",
    };
  }
  // Check if the quote appears only in an omitted/unread region so we can tell the user clearly.
  const omitted = complementRanges(sentRanges, fullText.length);
  for (const om of omitted) {
    const unreadSlice = fullText.slice(om.start, om.end);
    if (verifyQuote(unreadSlice, quote).verified) {
      return {
        verified: false,
        matchStart: null,
        matchEnd: null,
        verificationNote: "UNVERIFIED: Passage only appears in an omitted region that was NOT sent to the model.",
      };
    }
  }
  const near = closestPassage(sentText, quote);
  return {
    verified: false,
    matchStart: null,
    matchEnd: null,
    verificationNote: `UNVERIFIED: ${r.note}${near && near.overlap >= 0.5 ? ` Closest passage in the sent text (${Math.round(near.overlap * 100)}% of words match): "${near.text.slice(0, 400)}"` : ""}`,
  };
}

export interface GuardClaim {
  id: string;
  appraisalId: string;
  paperId: string;
  field: string;
  statement: string;
  quote: string;
  notReported: boolean;
  verified: boolean;
  userAccepted: boolean;
  userRejected: boolean;
  matchStart: number | null;
  matchEnd: number | null;
}

export interface GuardPaper {
  id: string;
  excluded?: boolean | null;
  title?: string;
  publicationTypes?: string[] | null;
}

export interface GuardAppraisal {
  id: string;
  paperId: string;
  sourceTextId: string | null;
  charsSentToModel: number | null;
  sentRanges?: TextRange[] | null;
}

export interface GuardSourceText {
  id: string;
  text: string;
  fullLength: number;
}

/**
 * Deterministic synthesis guard: filters claims so neither excluded papers nor unread/not-sent
 * text can enter the synthesis claim set.
 */
export function filterClaimsForSynthesis<T extends GuardClaim>(opts: {
  claims: T[];
  papersById: Map<string, GuardPaper>;
  appraisalsById: Map<string, GuardAppraisal>;
  sourceTextsById?: Map<string, GuardSourceText>;
}): T[] {
  return opts.claims.filter((c) => {
    if (c.notReported || c.userRejected) return false;
    if (!c.verified && !c.userAccepted) return false;

    const paper = opts.papersById.get(c.paperId);
    if (paper?.excluded) return false;

    const app = opts.appraisalsById.get(c.appraisalId);
    const st = app?.sourceTextId ? opts.sourceTextsById?.get(app.sourceTextId) : undefined;
    const effectiveSentRanges: TextRange[] | null =
      app?.sentRanges && app.sentRanges.length > 0
        ? app.sentRanges
        : app?.charsSentToModel !== null && app?.charsSentToModel !== undefined && st && app.charsSentToModel < st.text.length
          ? [{ start: 0, end: app.charsSentToModel }]
          : null;

    if (c.verified) {
      // If we know the appraisal was truncated or recorded sentRanges, require the verified span to lie strictly within sent text.
      if (effectiveSentRanges) {
        if (!isSpanWithinSentRanges(c.matchStart, c.matchEnd, effectiveSentRanges, app?.charsSentToModel, st?.fullLength)) {
          return false;
        }
      }
      return true;
    }

    // Unverified but user-accepted: still block if the quote only lives in an unread/omitted region.
    if (c.userAccepted && st && effectiveSentRanges) {
      const sentText = reconstructSentText(st.text, effectiveSentRanges);
      if (!verifyQuote(sentText, c.quote).verified) {
        const omitted = complementRanges(effectiveSentRanges, st.text.length);
        for (const om of omitted) {
          if (verifyQuote(st.text.slice(om.start, om.end), c.quote).verified) {
            return false;
          }
        }
      }
    }

    return true;
  });
}

/**
 * Deterministic check for synthesis output: a "known" statement must not rest solely on
 * non-study records (protocols, editorials, letters, comments, errata) or excluded papers.
 */
export function validateSynthesisKnownFindings(
  known: { statement: string; claimIds: string[] }[],
  claimToPaperId: Map<string, string>,
  nonStudyPaperIds: Set<string>,
): string | null {
  for (const k of known) {
    if (!k.claimIds.length) continue;
    const allNonStudy = k.claimIds.every((cid) => {
      const pid = claimToPaperId.get(cid);
      return pid ? nonStudyPaperIds.has(pid) : false;
    });
    if (allNonStudy) {
      return `Known statement "${k.statement.slice(0, 80)}" is supported only by non-study records (e.g. protocol/editorial/letter/comment/erratum); move it out of Known or cite completed empirical studies.`;
    }
  }
  return null;
}

export { hasNonStudyFlag };
