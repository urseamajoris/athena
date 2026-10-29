/**
 * Quote verification. A quote is "verified" only if it appears in the retrieved source text after
 * normalising whitespace, quote marks, dashes and case. Quotes containing an ellipsis ("..." or "…")
 * are verified part by part: every part must be in the text word for word. Returns character offsets
 * into the ORIGINAL text so the UI can highlight the passage.
 */

const MAP: Record<string, string> = {
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-", "­": "-",
};

/** Quote marks and apostrophes, in any style: dropped on both sides (models swap straight, curly and none). */
const QUOTE_MARKS = /["'`´‘’‚‛′“”„″«»]/;

/**
 * Spans skipped on BOTH sides before matching. They are layout or citation apparatus, not content, and models
 * routinely drop them when quoting: structured-abstract labels ("METHODS:"), numeric citation brackets ("[12]",
 * "[3-5]", and the empty "[]" left when references are stripped), table/figure pointers ("(Table 2)") and
 * author-year citations ("(Stanyon et al., 2021)"). Because the skip is symmetric, any change to the wording
 * itself still fails verification.
 */
const SKIPS = [
  /(?<![A-Za-z])[A-Z][A-Z&/ -]{2,30}:(?=\s)/g,
  /\[[\s\d,;–—-]*\]/g,
  /\((?:see\s+)?(?:tables?|fig\.?|figures?|supplementary|appendix|additional file)\b[^()]{0,30}\)/gi,
  /\((?=[^()]{0,120}\b(?:19|20)\d{2}[a-z]?\))[A-Z][^()]{0,120}\)/g,
  /\(\s*\)/g,
];

/**
 * Normalise and keep a map from each normalised char back to its original index. Whitespace, hyphens/dashes and
 * quote marks are dropped on both sides, so "In-depth" = "In depth" = "Indepth" (and the PDF line-break
 * hyphenation "in-\ndepth"), "n = 463" = "n=463" and "93 %" = "93%". Every letter, digit and other punctuation
 * mark must still match in order, so a changed, added or dropped word still fails.
 */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const skip = new Uint8Array(text.length);
  for (const re of SKIPS) for (const m of text.matchAll(re)) for (let k = m.index!; k < m.index! + m[0].length; k++) skip[k] = 1;
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (skip[i]) continue;
    const ch = MAP[text[i]] ?? text[i];
    if (ch === "-" || QUOTE_MARKS.test(ch) || /\s/.test(ch)) continue;
    const lower = ch.toLowerCase();
    // Keep a 1:1 mapping (toLowerCase can expand some chars; keep first char).
    norm += lower[0];
    map.push(i);
  }
  return { norm, map };
}

export function normalizeQuote(q: string): string {
  return normalizeWithMap(q.trim()).norm;
}

/** Where a quote is cut: an ellipsis ("...", ". . .", "…"), with or without square brackets. */
const ELLIPSIS = /\[?(?:\.\s?){2}\.\.*\]?|\[?…\]?/;

/**
 * The parts of a quote joined with "..." or "…" (one part for an ordinary quote). Shared with the UI, so the badge
 * ("found word for word, in two parts") counts parts exactly as the check does.
 */
export function quoteParts(quote: string): string[] {
  return quote.trim().split(ELLIPSIS).map((p) => p.trim()).filter((p) => normalizeQuote(p).length > 0);
}

/** "two", "three", ... for the part count in notes and badges. */
export function countWord(n: number): string {
  return ["no", "one", "two", "three", "four", "five", "six"][n] ?? String(n);
}

/** ", in two parts" for a quote joined from separate passages with "…"; "" for an ordinary quote. */
export function partsLabel(quote: string): string {
  const n = quoteParts(quote).length;
  return n > 1 ? `, in ${countWord(n)} parts` : "";
}

export interface QuoteCheck {
  verified: boolean;
  /** Offsets of the first (or only) part: what the UI highlights. */
  start: number | null;
  end: number | null;
  /** Offsets of every part, in the quote's order (a single entry for an ordinary quote). */
  parts: { start: number; end: number }[];
  note: string;
}

/** Each part of an ellipsis-joined quote must be at least this long, so short scraps cannot be strung together. */
const MIN_PART_WORDS = 4;
const MIN_PART_CHARS = 12;
const wordCount = (s: string) => s.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
const fail = (note: string): QuoteCheck => ({ verified: false, start: null, end: null, parts: [], note });

export function verifyQuote(source: string, quote: string, pre?: { norm: string; map: number[] }): QuoteCheck {
  const q = quote.trim();
  if (!q) return fail("No quote was provided.");
  const { norm, map } = pre ?? normalizeWithMap(source);
  const raw = quoteParts(q);
  // Sentence punctuation either side of an ellipsis (and at the very end) belongs to the cut, not to the words.
  const pieces = raw.map((p) => normalizeQuote(p).replace(/^[.,;:!?]+|[.,;:]+$/g, ""));
  if (!pieces.length || pieces.some((p) => !p)) return fail("Quote is empty after normalisation.");
  if (pieces.length > 1 && raw.some((p, i) => wordCount(p) < MIN_PART_WORDS || pieces[i].length < MIN_PART_CHARS)) {
    return fail(`Each part of a quote joined with "…" must be at least ${MIN_PART_WORDS} words long to verify.`);
  }
  if (pieces.length === 1 && pieces[0].length < 8) return fail("Quote is too short to verify reliably.");
  const found: { at: number; len: number }[] = [];
  let from = 0;
  let inOrder = true;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    // Prefer the next occurrence after the previous part; otherwise any occurrence that does not overlap a part
    // already found (models often quote the body and then the abstract, or the other way round).
    let at = norm.indexOf(p, from);
    if (at < 0) {
      for (let k = norm.indexOf(p); k >= 0; k = norm.indexOf(p, k + 1)) {
        if (!found.some((f) => k < f.at + f.len && f.at < k + p.length)) {
          at = k;
          inOrder = false;
          break;
        }
      }
    }
    if (at < 0) {
      return fail(pieces.length > 1 ? `Part ${i + 1} of ${pieces.length} not found in the source text: "${raw[i].slice(0, 80)}"` : "Quote not found in the retrieved source text.");
    }
    found.push({ at, len: p.length });
    from = at + p.length;
  }
  const parts = found.map((f) => ({ start: map[f.at], end: map[f.at + f.len - 1] + 1 }));
  const note =
    parts.length > 1
      ? `Found word for word, in ${countWord(parts.length)} parts: the quote joins separate passages with "…".${inOrder ? "" : " The parts are in a different order in the paper."}`
      : "Verified: exact match after whitespace/punctuation normalisation.";
  return { verified: true, start: parts[0].start, end: parts[0].end, parts, note };
}

/**
 * For a quote that is not found, say whether every sentence of it is in the text word for word on its own, which
 * usually means the model joined separate passages without marking the gap with "…". Still not verified (the quote
 * presents them as one passage), but it tells the user exactly what is wrong. Null when that is not the case.
 */
export function joinedWithoutEllipsis(source: string, quote: string, pre?: { norm: string; map: number[] }): string | null {
  if (quoteParts(quote).length !== 1) return null;
  const sentences = quote.trim().split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/).filter((s) => wordCount(s) >= MIN_PART_WORDS);
  if (sentences.length < 2) return null;
  const p = pre ?? normalizeWithMap(source);
  const found = sentences.map((s) => verifyQuote(source, s, p));
  if (!found.every((f) => f.verified)) return null;
  const adjacent = found.every((f, i) => i === 0 || (f.start! >= found[i - 1].end! && f.start! - found[i - 1].end! <= 3));
  if (adjacent) return `Each of its ${countWord(sentences.length)} sentences is in the paper word for word and in this order; only the punctuation between them differs.`;
  return `Each of its ${countWord(sentences.length)} sentences is in the paper word for word, but not next to each other: the quote joins separate passages without marking the gap with "…".`;
}

/**
 * For an unverified quote, find the passage of the source with the highest word overlap, to help the user
 * decide whether to accept or reject it. Purely advisory: it never marks a quote verified.
 */
export function closestPassage(source: string, quote: string): { text: string; overlap: number } | null {
  const words = [...source.matchAll(/\S+/g)].map((m) => ({ w: m[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""), s: m.index!, e: m.index! + m[0].length }));
  const q = quote.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
  if (q.length < 4 || words.length < q.length) return null;
  const want = new Map<string, number>();
  for (const w of q) want.set(w, (want.get(w) ?? 0) + 1);
  const have = new Map<string, number>();
  let hits = 0;
  const add = (w: string, d: number) => {
    const before = Math.min(have.get(w) ?? 0, want.get(w) ?? 0);
    have.set(w, (have.get(w) ?? 0) + d);
    hits += Math.min(have.get(w)!, want.get(w) ?? 0) - before;
  };
  const W = q.length;
  let best = { hits: -1, start: 0 };
  for (let i = 0; i < words.length; i++) {
    add(words[i].w, 1);
    if (i >= W) add(words[i - W].w, -1);
    if (i >= W - 1 && hits > best.hits) best = { hits, start: i - W + 1 };
  }
  const s = words[best.start].s;
  const e = words[Math.min(words.length - 1, best.start + W - 1)].e;
  return { text: source.slice(s, e), overlap: best.hits / W };
}

/** Which section of a full text contains an offset. */
export function sectionAt(sections: { title: string; start: number }[], offset: number): string | null {
  let cur: string | null = null;
  for (const s of sections) {
    if (s.start <= offset) cur = s.title;
    else break;
  }
  return cur;
}
