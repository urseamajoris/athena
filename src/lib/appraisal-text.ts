export interface TextRange {
  start: number;
  end: number;
}

export interface TextSection {
  title: string;
  start: number;
}

export interface AppraisalInput {
  text: string;
  sentRanges: TextRange[];
  omittedRanges: TextRange[];
  truncated: boolean;
  strategy: "full" | "sections" | "head_tail";
  charsSent: number;
  totalChars: number;
  includedSections: string[];
  omittedSections: string[];
  note: string;
}

export const OMISSION_MARKER = "\n\n[... omitted from model input due to length limit ...]\n\n";

type Bucket = "title" | "abstract" | "limitations" | "methods" | "results" | "discussion" | "other_body" | "boilerplate";

interface SectionSpan {
  title: string;
  start: number;
  end: number;
  bucket: Bucket;
}

const HEADING_PATTERNS: [Bucket, RegExp][] = [
  ["title", /^title$/i],
  ["abstract", /^(?:structured\s+)?abstract$|^summary$/i],
  ["limitations", /\blimitation/i],
  [
    "boilerplate",
    /\b(?:references?|bibliography|acknowledg(?:e)?ments?|funding|author\s+contributions?|declarations?|competing\s+interests?|conflicts?\s+of\s+interest|supplementary|appendix|additional\s+files?|abbreviations?|availability\s+of\s+data|data\s+availability|ethics\s+approval|consent\s+for\s+publication|publisher'?s?\s+note)\b/i,
  ],
  [
    "methods",
    /\b(?:methods?|methodology|materials?\s+and\s+methods?|study\s+design|design\s+and\s+setting|setting|participants?|population|sampling|data\s+collection|data\s+analysis|statistical\s+analysis|procedures?|interventions?|eligibility|search\s+strategy|experimental)\b/i,
  ],
  ["results", /\b(?:results?|findings?|outcomes?|main\s+findings?|observations?)\b/i],
  ["discussion", /\b(?:discussion|interpretation|implications?|conclusions?|general\s+discussion|summary\s+of\s+findings)\b/i],
];

function classifySection(title: string): Bucket {
  const t = title.trim();
  for (const [bucket, re] of HEADING_PATTERNS) {
    if (re.test(t)) return bucket;
  }
  return "other_body";
}

function isPageOnlySections(sections: TextSection[]): boolean {
  return sections.length === 0 || sections.every((s) => /^page\s+\d+$/i.test(s.title.trim()));
}

/**
 * Detect semantic section headings inside plain/PDF text when structured JATS sections are unavailable.
 */
export function detectSectionsInText(text: string): TextSection[] {
  const re =
    /(?:^|\n)(?:\d+(?:\.\d+)*\.?\s+)?(TITLE|ABSTRACT|INTRODUCTION|BACKGROUND|METHODS?|MATERIALS?\s+AND\s+METHODS?|STUDY\s+DESIGN|RESULTS?|FINDINGS?|DISCUSSION|STRENGTHS?\s+AND\s+LIMITATIONS?|LIMITATIONS?|CONCLUSIONS?|REFERENCES|ACKNOWLEDGMENTS?|ACKNOWLEDGEMENTS?)\s*(?:\n|:)/gim;
  const found: TextSection[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
    const title = m[1].trim();
    if (found.length === 0 || start - found[found.length - 1].start > 20) {
      found.push({ title, start });
    }
  }
  return found;
}

function mergeRanges(ranges: TextRange[], maxLen: number, fullText?: string): TextRange[] {
  const clean = ranges
    .map((r) => ({ start: Math.max(0, Math.min(maxLen, r.start)), end: Math.max(0, Math.min(maxLen, r.end)) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!clean.length) return [];
  const merged: TextRange[] = [{ ...clean[0] }];
  for (let i = 1; i < clean.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = clean[i];
    const gapOnlyWhitespace = fullText !== undefined && cur.start > prev.end && fullText.slice(prev.end, cur.start).trim() === "";
    if (cur.start <= prev.end || gapOnlyWhitespace) prev.end = Math.max(prev.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

export function complementRanges(sentRanges: TextRange[], totalLen: number): TextRange[] {
  const merged = mergeRanges(sentRanges, totalLen);
  const out: TextRange[] = [];
  let pos = 0;
  for (const r of merged) {
    if (r.start > pos) out.push({ start: pos, end: r.start });
    pos = r.end;
  }
  if (pos < totalLen) out.push({ start: pos, end: totalLen });
  return out;
}

export function reconstructSentText(fullText: string, sentRanges: TextRange[]): string {
  const merged = mergeRanges(sentRanges, fullText.length, fullText);
  return merged.map((r) => fullText.slice(r.start, r.end)).join(OMISSION_MARKER);
}

/**
 * Map a character span inside `reconstructSentText(fullText, sentRanges)` back to exact offsets in `fullText`.
 * Returns null if the span crosses an omission marker boundary.
 */
export function mapSentSpanToOriginal(
  sentStart: number,
  sentEnd: number,
  fullText: string,
  sentRanges: TextRange[],
): { start: number; end: number } | null {
  if (sentStart < 0 || sentEnd <= sentStart) return null;
  const merged = mergeRanges(sentRanges, fullText.length, fullText);
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    const len = r.end - r.start;
    if (sentStart >= cursor && sentEnd <= cursor + len) {
      return { start: r.start + (sentStart - cursor), end: r.start + (sentEnd - cursor) };
    }
    cursor += len + (i < merged.length - 1 ? OMISSION_MARKER.length : 0);
  }
  return null;
}

/**
 * Check whether an original-text match span lies completely inside the ranges sent to the model.
 */
export function isSpanWithinSentRanges(
  matchStart: number | null | undefined,
  matchEnd: number | null | undefined,
  sentRanges: TextRange[] | null | undefined,
  charsSentToModel?: number | null,
  fullLength?: number | null,
): boolean {
  if (matchStart === null || matchStart === undefined || matchEnd === null || matchEnd === undefined) return false;
  if (matchStart < 0 || matchEnd <= matchStart) return false;
  if (sentRanges && sentRanges.length > 0) {
    return sentRanges.some((r) => matchStart >= r.start && matchEnd <= r.end);
  }
  if (charsSentToModel !== null && charsSentToModel !== undefined) {
    return matchEnd <= charsSentToModel;
  }
  if (fullLength !== null && fullLength !== undefined) {
    return matchEnd <= fullLength;
  }
  return true;
}

/** Trim a span end cleanly back to a paragraph or sentence boundary when possible. */
function trimEndCleanly(text: string, start: number, maxEnd: number): number {
  const clamped = Math.min(text.length, maxEnd);
  if (clamped <= start) return start;
  const minKeep = start + Math.floor((clamped - start) * 0.65);
  const para = text.lastIndexOf("\n\n", clamped);
  if (para >= minKeep) return para;
  const nl = text.lastIndexOf("\n", clamped);
  if (nl >= minKeep) return nl;
  const period = text.lastIndexOf(". ", clamped);
  if (period >= minKeep) return period + 1;
  return clamped;
}

/** Find `[Table] ...` caption ranges inside a slice of fullText that wasn't already covered. */
function findTableCaptionRanges(fullText: string, covered: TextRange[]): TextRange[] {
  const re = /^\[Table\][^\n]*/gm;
  const out: TextRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const already = covered.some((r) => start >= r.start && end <= r.end);
    if (!already) out.push({ start, end });
  }
  return out;
}

/**
 * Allocate budget across buckets with target weights, redistributing leftover budget from shorter buckets
 * to longer ones (water-filling) so methods/results never starve discussion/limitations.
 */
function allocateBudgets(needs: Record<string, number>, weights: Record<string, number>, totalBudget: number): Record<string, number> {
  const alloc: Record<string, number> = {};
  const active = Object.keys(needs).filter((k) => needs[k] > 0);
  for (const k of Object.keys(needs)) alloc[k] = 0;
  let remaining = Math.max(0, totalBudget);
  let pool = [...active];
  while (pool.length > 0 && remaining > 0) {
    const wSum = pool.reduce((a, k) => a + (weights[k] ?? 1), 0);
    let progressed = false;
    const nextPool: string[] = [];
    let spentThisRound = 0;
    for (const k of pool) {
      const share = Math.floor((remaining * (weights[k] ?? 1)) / wSum);
      const want = needs[k] - alloc[k];
      if (want <= share) {
        alloc[k] += want;
        spentThisRound += want;
        progressed = true;
      } else {
        alloc[k] += share;
        spentThisRound += share;
        if (share > 0) progressed = true;
        nextPool.push(k);
      }
    }
    remaining -= spentThisRound;
    if (!progressed) {
      // Distribute remaining single characters if floor left a small remainder.
      for (const k of nextPool) {
        if (remaining <= 0) break;
        if (alloc[k] < needs[k]) {
          alloc[k] += 1;
          remaining -= 1;
        }
      }
      break;
    }
    pool = nextPool;
  }
  return alloc;
}

function takeSpansWithBudget(fullText: string, spans: SectionSpan[], budget: number, preferLimitationsTail = false): TextRange[] {
  if (budget <= 0 || !spans.length) return [];
  const totalLen = spans.reduce((a, s) => a + (s.end - s.start), 0);
  if (totalLen <= budget) return spans.map((s) => ({ start: s.start, end: s.end }));

  // If trimming a Discussion section that has no separate Limitations section, preserve any paragraph mentioning "limitation".
  if (preferLimitationsTail && spans.length === 1 && budget >= 240) {
    const s = spans[0];
    const body = fullText.slice(s.start, s.end);
    const limIdx = body.search(/\blimitation/i);
    if (limIdx >= 0) {
      const paraStart = Math.max(0, body.lastIndexOf("\n\n", limIdx));
      const tailLen = body.length - paraStart;
      const tailBudget = Math.min(tailLen, Math.floor(budget * 0.5));
      const headBudget = budget - tailBudget - OMISSION_MARKER.length;
      if (headBudget >= 100 && paraStart > headBudget) {
        const headEnd = trimEndCleanly(fullText, s.start, s.start + headBudget);
        const tailStart = s.start + paraStart;
        const tailEnd = trimEndCleanly(fullText, tailStart, tailStart + tailBudget);
        return [
          { start: s.start, end: headEnd },
          { start: tailStart, end: tailEnd },
        ];
      }
    }
  }

  const out: TextRange[] = [];
  let left = budget;
  for (const s of spans) {
    if (left <= 0) break;
    const len = s.end - s.start;
    if (len <= left) {
      out.push({ start: s.start, end: s.end });
      left -= len;
    } else if (left >= 80) {
      const end = trimEndCleanly(fullText, s.start, s.start + left);
      if (end > s.start) out.push({ start: s.start, end });
      left = 0;
    } else {
      break;
    }
  }
  return out;
}

/**
 * Build the text sent to the appraisal model.
 * When `fullText` exceeds `maxChars`, selects priority sections (title, abstract, methods, results,
 * discussion, limitations, plus table captions) instead of taking a blind prefix.
 */
export function buildAppraisalInput(fullText: string, sections: TextSection[], maxChars: number): AppraisalInput {
  const totalChars = fullText.length;
  if (totalChars <= maxChars) {
    const sentRanges = totalChars > 0 ? [{ start: 0, end: totalChars }] : [];
    return {
      text: fullText,
      sentRanges,
      omittedRanges: [],
      truncated: false,
      strategy: "full",
      charsSent: totalChars,
      totalChars,
      includedSections: sections.map((s) => s.title),
      omittedSections: [],
      note: "",
    };
  }

  const semanticSections = isPageOnlySections(sections) ? detectSectionsInText(fullText) : sections;
  const sorted = [...semanticSections].filter((s) => s.start >= 0 && s.start < totalChars).sort((a, b) => a.start - b.start);

  // Build section spans if we have at least 2 meaningful sections (not just a single block).
  if (sorted.length >= 2) {
    const spans: SectionSpan[] = [];
    if (sorted[0].start > 0) {
      spans.push({ title: "Title", start: 0, end: sorted[0].start, bucket: "title" });
    }
    let activeParent: Bucket = "other_body";
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i].start;
      const end = i + 1 < sorted.length ? sorted[i + 1].start : totalChars;
      if (end <= start) continue;
      let bucket = classifySection(sorted[i].title);
      if (/^(?:introduction|background|overview|context|rationale)\b/i.test(sorted[i].title.trim())) {
        activeParent = "other_body";
      } else if (bucket === "methods" || bucket === "results" || bucket === "discussion") {
        activeParent = bucket;
      } else if (bucket === "limitations" || bucket === "boilerplate") {
        activeParent = "other_body";
      } else if (bucket === "other_body" && (activeParent === "methods" || activeParent === "results" || activeParent === "discussion")) {
        // Subsections nested under Methods, Results, or Discussion (common in JATS XML) inherit their parent section's priority.
        bucket = activeParent;
      }
      spans.push({ title: sorted[i].title, start, end, bucket });
    }

    const byBucket: Record<Bucket, SectionSpan[]> = {
      title: [],
      abstract: [],
      limitations: [],
      methods: [],
      results: [],
      discussion: [],
      other_body: [],
      boilerplate: [],
    };
    for (const sp of spans) byBucket[sp.bucket].push(sp);

    const hasCoreSections =
      byBucket.methods.length + byBucket.results.length + byBucket.discussion.length + byBucket.limitations.length > 0;

    if (hasCoreSections) {
      // Reserve headroom for omission markers (at most ~6 gaps in practice).
      const markerReserve = Math.min(Math.floor(maxChars * 0.1), OMISSION_MARKER.length * 6);
      const effectiveBudget = Math.max(200, maxChars - markerReserve);

      const sumLen = (arr: SectionSpan[]) => arr.reduce((a, s) => a + (s.end - s.start), 0);
      const needs: Record<string, number> = {
        title: sumLen(byBucket.title),
        abstract: sumLen(byBucket.abstract),
        limitations: sumLen(byBucket.limitations),
        methods: sumLen(byBucket.methods),
        results: sumLen(byBucket.results),
        discussion: sumLen(byBucket.discussion),
      };
      const weights: Record<string, number> = {
        title: 0.05,
        abstract: 0.12,
        limitations: 0.18,
        methods: 0.22,
        results: 0.25,
        discussion: 0.18,
      };
      const alloc = allocateBudgets(needs, weights, effectiveBudget);

      let chosen: TextRange[] = [
        ...takeSpansWithBudget(fullText, byBucket.title, alloc.title),
        ...takeSpansWithBudget(fullText, byBucket.abstract, alloc.abstract),
        ...takeSpansWithBudget(fullText, byBucket.methods, alloc.methods),
        ...takeSpansWithBudget(fullText, byBucket.results, alloc.results),
        ...takeSpansWithBudget(fullText, byBucket.discussion, alloc.discussion, byBucket.limitations.length === 0),
        ...takeSpansWithBudget(fullText, byBucket.limitations, alloc.limitations),
      ];
      chosen = mergeRanges(chosen, totalChars, fullText);

      // Preserve [Table] captions from any trimmed or omitted sections.
      const captionRanges = findTableCaptionRanges(fullText, chosen);
      if (captionRanges.length) {
        const captionMax = Math.max(120, Math.floor(maxChars * 0.08));
        let capUsed = 0;
        const addedCaps: TextRange[] = [];
        for (const cr of captionRanges) {
          const len = cr.end - cr.start;
          if (capUsed + len > captionMax) break;
          addedCaps.push(cr);
          capUsed += len;
        }
        if (addedCaps.length) {
          // If adding captions would exceed maxChars, trim a matching amount from the largest non-limitations range.
          chosen = mergeRanges([...chosen, ...addedCaps], totalChars, fullText);
        }
      }

      // If budget remains, add other_body sections (e.g. Introduction/Background).
      let currentText = reconstructSentText(fullText, chosen);
      if (currentText.length + OMISSION_MARKER.length + 120 < maxChars && byBucket.other_body.length) {
        const extraBudget = maxChars - currentText.length - OMISSION_MARKER.length;
        const extras = takeSpansWithBudget(fullText, byBucket.other_body, extraBudget);
        if (extras.length) {
          chosen = mergeRanges([...chosen, ...extras], totalChars, fullText);
          currentText = reconstructSentText(fullText, chosen);
        }
      }

      // Final hard cap enforcement: trim from the largest non-title/abstract/limitations span if slightly over maxChars.
      while (currentText.length > maxChars && chosen.length > 0) {
        const overflow = currentText.length - maxChars;
        let victimIdx = -1;
        let victimLen = 0;
        for (let i = 0; i < chosen.length; i++) {
          const r = chosen[i];
          const len = r.end - r.start;
          const isProtected =
            byBucket.limitations.some((l) => r.start >= l.start && r.end <= l.end) ||
            (byBucket.limitations.length === 0 && /\blimitation/i.test(fullText.slice(r.start, r.end))) ||
            byBucket.title.some((t) => r.start >= t.start && r.end <= t.end) ||
            byBucket.abstract.some((a) => r.start >= a.start && r.end <= a.end) ||
            fullText.slice(r.start, r.start + 7) === "[Table]";
          if (!isProtected && len > victimLen) {
            victimLen = len;
            victimIdx = i;
          }
        }
        if (victimIdx < 0) {
          // Fall back to trimming largest range overall.
          for (let i = 0; i < chosen.length; i++) {
            const len = chosen[i].end - chosen[i].start;
            if (len > victimLen) {
              victimLen = len;
              victimIdx = i;
            }
          }
        }
        if (victimIdx < 0 || victimLen <= 1) break;
        const target = chosen[victimIdx];
        const shrinkBy = Math.min(overflow + 40, victimLen - 1);
        const newEnd = Math.max(target.start + 1, target.end - shrinkBy);
        chosen[victimIdx] = { start: target.start, end: newEnd };
        chosen = mergeRanges(chosen, totalChars, fullText);
        currentText = reconstructSentText(fullText, chosen);
      }

      const omittedRanges = complementRanges(chosen, totalChars);
      const charsSent = chosen.reduce((a, r) => a + (r.end - r.start), 0);
      const includedSections: string[] = [];
      const omittedSections: string[] = [];
      for (const sp of spans) {
        const overlap = chosen.reduce((a, r) => a + Math.max(0, Math.min(sp.end, r.end) - Math.max(sp.start, r.start)), 0);
        if (overlap > 0) includedSections.push(sp.title);
        if (overlap < sp.end - sp.start) omittedSections.push(sp.title);
      }
      const note = `Long text: the model was sent ${charsSent.toLocaleString()} of ${totalChars.toLocaleString()} characters from priority sections (${[...new Set(includedSections)].join(", ")}). Omitted regions (${(totalChars - charsSent).toLocaleString()} characters${omittedSections.length ? `, incl. ${[...new Set(omittedSections)].slice(0, 6).join(", ")}` : ""}) were not sent to the model.`;

      return {
        text: currentText,
        sentRanges: chosen,
        omittedRanges,
        truncated: omittedRanges.length > 0,
        strategy: "sections",
        charsSent,
        totalChars,
        includedSections: [...new Set(includedSections)],
        omittedSections: [...new Set(omittedSections)],
        note,
      };
    }
  }

  // Fallback when no semantic section headings exist: keep head (60%) + tail (40%) so limitations/discussion at the end aren't blindly dropped.
  const budget = Math.max(100, maxChars - OMISSION_MARKER.length);
  const headBudget = Math.floor(budget * 0.6);
  const tailBudget = budget - headBudget;
  const headEnd = trimEndCleanly(fullText, 0, headBudget);
  const tailStart = Math.max(headEnd + 1, totalChars - tailBudget);
  const chosen = mergeRanges(
    [
      { start: 0, end: headEnd },
      { start: tailStart, end: totalChars },
    ],
    totalChars,
  );
  const text = reconstructSentText(fullText, chosen);
  const omittedRanges = complementRanges(chosen, totalChars);
  const charsSent = chosen.reduce((a, r) => a + (r.end - r.start), 0);
  return {
    text,
    sentRanges: chosen,
    omittedRanges,
    truncated: omittedRanges.length > 0,
    strategy: "head_tail",
    charsSent,
    totalChars,
    includedSections: [],
    omittedSections: [],
    note: `Long unstructured text: the model was sent ${charsSent.toLocaleString()} of ${totalChars.toLocaleString()} characters (opening and closing sections); the omitted middle (${(totalChars - charsSent).toLocaleString()} characters) was not sent to the model.`,
  };
}

/**
 * Partition full source text into alternating sent and not-sent regions for display in the source pane.
 */
export function partitionSourceForDisplay(
  fullText: string,
  sentRanges: TextRange[] | null | undefined,
  charsSentToModel?: number | null,
): { start: number; end: number; sent: boolean }[] {
  const len = fullText.length;
  if (len === 0) return [];
  let normalized: TextRange[];
  if (sentRanges && sentRanges.length > 0) {
    normalized = mergeRanges(sentRanges, len, fullText);
  } else if (charsSentToModel !== null && charsSentToModel !== undefined && charsSentToModel < len) {
    normalized = charsSentToModel > 0 ? [{ start: 0, end: charsSentToModel }] : [];
  } else {
    return [{ start: 0, end: len, sent: true }];
  }

  const out: { start: number; end: number; sent: boolean }[] = [];
  let pos = 0;
  for (const r of normalized) {
    if (r.start > pos) out.push({ start: pos, end: r.start, sent: false });
    if (r.end > r.start) out.push({ start: r.start, end: r.end, sent: true });
    pos = r.end;
  }
  if (pos < len) out.push({ start: pos, end: len, sent: false });
  return out;
}

/**
 * Accurate, distinct provenance note for full-text sources so Europe PMC JATS XML
 * (which drops table and figure bodies) is never conflated with PDF extraction.
 */
export function fullTextSourceNote(source: string, license: string | null | undefined, pmcid?: string | null): string {
  const lic = license ? ` (licence: ${license})` : "";
  if (source === "europepmc" || source === "pmc") {
    return `Full text from Europe PMC JATS XML${pmcid ? ` (${pmcid})` : ""}${lic}. Table and figure bodies were not included (only prose and captions were extracted) — unlike a PDF extraction, data inside tables was not read.`;
  }
  if (source === "unpaywall_pdf") {
    return `Full text extracted from an open-access PDF via Unpaywall${lic}. PDF text extraction includes raw table text but can garble tables and multi-column layouts (unlike Europe PMC XML, which omits table and figure bodies).`;
  }
  return `Full text from ${source}${lic}.`;
}

export function fullTextSourceLabel(textSource: string, sourceOrigin: string | null | undefined, truncated = false): string {
  if (textSource !== "full_text") return "abstract only";
  const prefix = truncated ? "partial full text" : "full text";
  if (sourceOrigin === "europepmc" || sourceOrigin === "pmc") {
    return `${prefix} (Europe PMC XML — table and figure bodies not included)`;
  }
  if (sourceOrigin === "unpaywall_pdf") {
    return `${prefix} (PDF extraction — tables may be garbled)`;
  }
  return prefix;
}
