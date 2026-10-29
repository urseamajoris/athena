/*
 * Abstract hygiene at ingestion. Databases sometimes fill the abstract field with publication apparatus instead of
 * an abstract: OpenAlex in particular can reconstruct a data-availability statement, a funding or conflict-of-
 * interest note, or a copyright line as the "abstract", and the AI then summarises it as the paper's finding.
 * Such sentences are cut from the start and end; if nothing that reads like an abstract is left, the paper is
 * treated as having no abstract (the UI already says "no abstract available"). Pure, so it is unit-tested.
 */

/** Sentences that are publication apparatus, not a description of the study. */
const BOILERPLATE: RegExp[] = [
  // data availability
  /\bdata (availability|access|sharing) statement\b/i,
  /\b(are|is|will be|can be|may be|be) (made )?(available|obtained|provided|shared|accessed)\b[^.]{0,120}\b(up)?on (a )?(reasonable |justified |written )?request\b/i,
  /\bavailable from the (corresponding )?authors?\b/i,
  /\b(data|datasets?|code|materials?)\b[^.]{0,120}\b(are|is|will be|have been) (made )?(publicly |freely |openly )?available (in|at|on|from|via|through)\b[^.]{0,120}\b(repositor|zenodo|figshare|dryad|github|osf|supplement)/i,
  /\b(data|datasets?)\b[^.]{0,120}\bcannot be (shared|made available|made public)/i,
  /^all (relevant )?data are (within|in) the (paper|manuscript|article)/i,
  // funding
  /^(funding|financial support|grant support|sources? of funding)\s*(statement)?\s*[:.]/i,
  /^(this|the) (work|study|research|project|trial|article) (was|is|has been) (partly |partially |financially )?(supported|funded|financed) by\b/i,
  /\bthe funders? (had|has|played) no role\b/i,
  // conflicts of interest
  /^(conflicts? of interests?|competing interests?|declarations? of (competing )?interests?|disclosures?)( statement)?\s*[:.]/i,
  /\b(declare|declares|report|reports)( that they have)? no (known )?(conflicts?|competing)\b/i,
  /\bthe authors? (declare|report|have|has) no\b/i,
  // copyright, licence and publisher notes
  /©|\(c\) ?(19|20)\d{2}\b|\bcopyright\b|\ball rights reserved\b/i,
  /^published by\b|\blicensee\b/i,
  /\bthis is an open[ -]access article\b|\bcreative commons\b/i,
  /\bthe publisher is not responsible\b|\bany queries \(other than missing content\)/i,
  /\bsupporting information (may be found|can be found|is available)\b/i,
];

/** A text shorter than this is not an abstract (a heading, a stray label). */
const MIN_CHARS = 80;
const MIN_WORDS = 12;

/** Sentence boundaries: after . ! or ? and before a capital or digit, but not after a title or "et al.". */
const BOUNDARY = /(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|Fig|No|vs|al|St|Inc|Ltd|Co|e\.g|i\.e)\.)(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/g;

export function isBoilerplateSentence(s: string): boolean {
  return BOILERPLATE.some((re) => re.test(s.trim()));
}

/**
 * The usable abstract, or null when the text is missing, too short, or only boilerplate. Boilerplate is cut only
 * from the start and end, so a real abstract that mentions funding or data in the middle is kept as it is.
 */
export function usableAbstract(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const spans: [number, number][] = [];
  let from = 0;
  for (const m of t.matchAll(BOUNDARY)) {
    spans.push([from, m.index!]);
    from = m.index! + m[0].length;
  }
  spans.push([from, t.length]);
  let a = 0;
  let b = spans.length;
  while (a < b && isBoilerplateSentence(t.slice(...spans[a]))) a++;
  while (b > a && isBoilerplateSentence(t.slice(...spans[b - 1]))) b--;
  if (a === b) return null;
  const kept = t.slice(spans[a][0], spans[b - 1][1]).trim();
  const words = kept.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return kept.length < MIN_CHARS || words < MIN_WORDS ? null : kept;
}
