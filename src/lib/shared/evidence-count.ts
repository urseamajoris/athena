// How many papers stand behind a synthesis statement (unit-tested in evidence-count.test.ts). A "known" statement
// whose quotes all come from one paper is one study's finding, not agreement, so step 8 says so on the statement.

/** Distinct papers the given quotes come from; quotes that are not in `claims` are ignored. */
export function paperCount(claimIds: string[], claims: Record<string, { paperId: string } | undefined>): number {
  return new Set(claimIds.map((id) => claims[id]?.paperId).filter(Boolean)).size;
}

/** "1 paper", "3 papers"; a single-paper "known" statement reads "1 paper only". Null when no quote resolves. */
export function paperCountLabel(n: number, kind: string): { text: string; title: string } | null {
  if (n < 1) return null;
  if (n === 1 && kind === "known") return { text: "1 paper only", title: "All its quotes come from one paper: this is one study's finding, not agreement between papers." };
  return { text: `${n} paper${n === 1 ? "" : "s"}`, title: `Its quotes come from ${n === 1 ? "one paper" : `${n} different papers`}.` };
}
