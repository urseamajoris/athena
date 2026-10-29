// When a "Do these things" item counts as done. Pure, so the rules are unit-tested: an item is done only when the
// user did it, or its condition is really met on loaded, finished data (never vacuously, e.g. "0 of 11 looked at").

/** Ranking: "Keep 3–5 papers per topic". Before the ranking has finished there are no scores, so no topic is short
 *  or over: that is not the rule being met. */
export function keepRuleDone(o: { ranked: boolean; running: boolean; topics: number; short: number; over: number }): boolean {
  return o.ranked && !o.running && o.topics > 0 && o.short === 0 && o.over === 0;
}

/** Appraisal: "Look at each paper" and "Decide every quote the check could not find". Both wait until every
 *  selected paper's appraisal has finished; "0 left" with nothing to decide is done only then. */
export function appraisalChecks(o: { running: boolean; appraisals: { id: string; status: string }[]; reviewed: string[]; undecided: number }): { looked: boolean; decided: boolean } {
  const finished = !o.running && o.appraisals.length > 0 && o.appraisals.every((a) => a.status === "done" || a.status === "failed");
  const done = o.appraisals.filter((a) => a.status === "done");
  return {
    looked: finished && done.length > 0 && done.every((a) => o.reviewed.includes(a.id)),
    decided: finished && o.undecided === 0,
  };
}
