// Does a fetched full text belong to the paper it was fetched for? Pure (unit-tested).

// Words that carry no identity on their own, so "the" or "of" in two titles is never a match.
const STOP = new Set("a an and the of in on for to with by at from as or its their is are was were be into among between during after before over under via vs versus about this that these those".split(" "));

/** Content words, lower-case, accents and hyphens removed ("tele-\nrehabilitation" and "Tele-rehabilitation" both → "telerehabilitation"). */
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[-‐‑]\s*\n\s*/g, "")
    .replace(/[-‐‑]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w));
}

// Study-design words and place names that many titles share ("… in South East Asia: a scoping review"). A word pair
// made only of these says nothing about which paper a text is, so it is left out of the comparison.
const GENERIC = new Set(
  ("review reviews scoping systematic metaanalysis meta analysis narrative rapid umbrella literature study studies protocol trial " +
    "randomised randomized controlled pilot cohort casecontrol crosssectional qualitative mixed methods evidence synthesis survey " +
    "south north east west southeast southern northern eastern western central asia asian africa african europe european america " +
    "american pacific region regional global countries country lowincome middleincome highincome lmics world").split(" "),
);
const pairs = (ws: string[]) => ws.slice(1).map((w, i) => `${ws[i]} ${w}`).filter((p) => !p.split(" ").every((w) => GENERIC.has(w)));

/** Share of `a`'s adjacent word pairs that also appear in `b`. */
function coverage(a: string[], b: string[]): number {
  const pa = pairs(a);
  if (!pa.length) return 0;
  const pb = new Set(pairs(b));
  return pa.filter((p) => pb.has(p)).length / pa.length;
}

/** The title a full text announces: the TITLE section of a Europe PMC text (see jatsToText), if it has one. */
export function ownTitle(text: string): string | null {
  return text.match(/^\s*TITLE[ \t]*\n([^\n]+(?:\n[^\n]+)*)/)?.[1].trim() || null;
}

/**
 * False only when the text clearly belongs to another paper: few of the paper title's adjacent word pairs appear in
 * the text's own title (or, without one, in its opening, where a PDF prints the title), and the text's title is not a
 * shortened form of the paper's ("X" for "X: a systematic review"). Word pairs rather than single words, so a text
 * that merely shares a topic ("COVID-19 pandemic", "Singapore") is not taken for the paper. Titles too short to judge pass.
 */
export function fullTextMatchesTitle(title: string, text: string): boolean {
  const want = words(title);
  if (want.length < 3) return true;
  const own = ownTitle(text);
  const have = words(own ?? text.slice(0, 3000));
  return coverage(want, have) >= 0.5 || (!!own && have.length >= 3 && coverage(have, want) >= 0.5);
}
