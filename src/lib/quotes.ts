/**
 * Quote verification. A quote is "verified" only if it appears in the retrieved source text after
 * normalising whitespace, quote marks, dashes and case. Quotes containing an ellipsis ("..." or "…")
 * are verified piece by piece, in order. Returns character offsets into the ORIGINAL text so the UI can
 * highlight the passage.
 */

const MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-",
  " ": " ", " ": " ", " ": " ",
};

/**
 * Spans skipped on BOTH sides before matching. They are layout or citation apparatus, not content, and models
 * routinely drop them when quoting: structured-abstract labels ("METHODS:"), numeric citation brackets ("[12]",
 * "[3-5]", and the empty "[]" left when references are stripped), table/figure pointers ("(Table 2)") and
 * author-year citations ("(Stanyon et al., 2021)"). Because the skip is symmetric, any change to the wording
 * itself still fails verification.
 */
const SKIPS = [
  /(?<![A-Za-z])[A-Z][A-Z&/ -]{2,30}:(?=\s)/g,
  /\[[\s\d,;\u2013\u2014-]*\]/g,
  /\((?:see\s+)?(?:tables?|fig\.?|figures?|supplementary|appendix|additional file)\b[^()]{0,30}\)/gi,
  /\((?=[^()]{0,120}\b(?:19|20)\d{2}[a-z]?\))[A-Z][^()]{0,120}\)/g,
  /\(\s*\)/g,
];

/** Normalise and keep a map from each normalised char back to its original index. */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const skip = new Uint8Array(text.length);
  for (const re of SKIPS) for (const m of text.matchAll(re)) for (let k = m.index!; k < m.index! + m[0].length; k++) skip[k] = 1;
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  let afterHyphen = false;
  for (let i = 0; i < text.length; i++) {
    if (skip[i]) continue;
    let ch = text[i];
    ch = MAP[ch] ?? ch;
    // Hyphens are dropped on both sides ("in-depth" = "in-\ndepth" = "indepth"), and a line break right after a
    // hyphen is a PDF hyphenation artefact, so it does not become a space.
    if (ch === "-") {
      afterHyphen = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (afterHyphen && /\n/.test(text.slice(i, i + 3))) continue;
      if (lastSpace) continue;
      norm += " ";
      map.push(i);
      lastSpace = true;
      continue;
    }
    afterHyphen = false;
    // No space before punctuation (so a skipped citation before a full stop leaves no gap).
    if (/[.,;:]/.test(ch) && norm.endsWith(" ")) {
      norm = norm.slice(0, -1);
      map.pop();
    }
    const lower = ch.toLowerCase();
    // Keep a 1:1 mapping (toLowerCase can expand some chars; keep first char).
    norm += lower[0];
    map.push(i);
    lastSpace = false;
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

export function normalizeQuote(q: string): string {
  return normalizeWithMap(q.trim().replace(/^["'“‘]+|["'”’]+$/g, "")).norm;
}

export interface QuoteCheck {
  verified: boolean;
  start: number | null;
  end: number | null;
  note: string;
}

const MIN_PIECE = 12;

export function verifyQuote(source: string, quote: string, pre?: { norm: string; map: number[] }): QuoteCheck {
  const q = quote.trim();
  if (!q) return { verified: false, start: null, end: null, note: "No quote was provided." };
  const { norm, map } = pre ?? normalizeWithMap(source);
  const pieces = q
    .split(/\.{3,}|…|\[\.\.\.\]|\[…\]/)
    .map((p) => normalizeQuote(p))
    .filter((p) => p.length > 0);
  if (pieces.length) pieces[pieces.length - 1] = pieces[pieces.length - 1].replace(/[.,;:]+$/, "");
  if (!pieces.length) return { verified: false, start: null, end: null, note: "Quote is empty after normalisation." };
  if (pieces.some((p) => p.length < MIN_PIECE) && pieces.length > 1) {
    return { verified: false, start: null, end: null, note: "Quote fragments around an ellipsis are too short to verify." };
  }
  if (pieces.length === 1 && pieces[0].length < 8) {
    return { verified: false, start: null, end: null, note: "Quote is too short to verify reliably." };
  }
  let from = 0;
  let start: number | null = null;
  let endNorm = 0;
  for (const p of pieces) {
    const at = norm.indexOf(p, from);
    if (at < 0) {
      return {
        verified: false,
        start: null,
        end: null,
        note: pieces.length > 1 ? `Fragment not found in source text: "${p.slice(0, 80)}"` : "Quote not found in the retrieved source text.",
      };
    }
    if (start === null) start = at;
    endNorm = at + p.length;
    from = endNorm;
  }
  const s = map[start!];
  const e = map[endNorm - 1] + 1;
  return { verified: true, start: s, end: e, note: pieces.length > 1 ? "Verified (fragments matched in order)." : "Verified: exact match after whitespace/punctuation normalisation." };
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
