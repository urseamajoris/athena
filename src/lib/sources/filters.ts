// The optional hard article-type retrieval filter, per database. Pure (unit-tested).

const REVIEW_PT = '(review[pt] OR "systematic review"[pt] OR meta-analysis[pt])';
/** The optional hard article-type filter as a PubMed clause (null = no filter). */
export function hardFilterPubmed(types: string[] | undefined): string | null {
  const t = new Set(types ?? []);
  if (!t.size || t.size === 3) return null;
  const clauses: string[] = [];
  if (t.has("review")) clauses.push(REVIEW_PT);
  if (t.has("preprint")) clauses.push("preprint[pt]");
  if (t.has("journal_article")) clauses.push(`("journal article"[pt] NOT ${REVIEW_PT} NOT preprint[pt])`);
  return `(${clauses.join(" OR ")})`;
}

/** OpenAlex work types to fetch: the hard filter's types, or the default articles, reviews and preprints. */
export function openalexTypes(types: string[] | undefined): string {
  const hard = (types ?? []).map((t) => (t === "journal_article" ? "article" : t)).filter((t) => ["article", "review", "preprint"].includes(t));
  return hard.length ? hard.join("|") : "article|review|preprint";
}
