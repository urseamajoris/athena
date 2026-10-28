/**
 * Repair an ID only when it is an unambiguous formatting slip of an allowed ID (missing "c_" prefix or
 * underscore, stray whitespace/brackets). Anything else is returned unchanged so the grounding check rejects it.
 */
export function repairId(id: string, allowed: string[]): string {
  if (allowed.includes(id)) return id;
  const bare = (s: string) => s.trim().replace(/^[[("']+|[\])"']+$/g, "").replace(/_/g, "").toLowerCase();
  const b = bare(id);
  const hits = allowed.filter((a) => bare(a) === b || a.split("_")[1] === b);
  return hits.length === 1 ? hits[0] : id;
}
