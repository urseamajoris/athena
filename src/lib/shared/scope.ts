// The idea's scope as the scoping answers set it (where, and which years), and how papers and searches compare to
// it. Pure: used by the search builder and ranking on the server and by the panels in the browser (unit-tested).

/** Scoping answers that mean "no limit" rather than a place. */
const NO_SETTING = /^(?:not specified|not stated|unspecified|none|any|anywhere|n\/?a|no preference|global|worldwide|international|all countries|any setting|any country)\.?$/i;

/** The idea's setting (a country, a region, a care setting) from the scoping summary, or null when it has none. */
export function ideaSetting(summary: Record<string, string> | null | undefined): string | null {
  const s = summary?.setting?.trim();
  return s && !NO_SETTING.test(s) ? s : null;
}

/**
 * Whether a paper is set in the idea's setting, as far as the abstract shows. `settingMatch` is the AI's 0–5
 * rating from ranking (3 or more: in the setting, alone or among other places); without it, the paper's own
 * setting text is checked for the setting's words. Fuzzy by nature, so the panels word it as "check", not a verdict.
 */
export type SettingFit = "match" | "differs" | "not_reported";
export function settingFit(setting: string, paperSetting: string | null | undefined, settingMatch?: number | null): SettingFit {
  const text = paperSetting?.trim() ?? "";
  if (typeof settingMatch === "number" && settingMatch >= 3) return "match";
  if (!text || /^not (?:reported|stated|clear)/i.test(text)) return "not_reported";
  if (typeof settingMatch === "number") return "differs";
  return settingWords(setting).some((w) => text.toLowerCase().includes(w)) ? "match" : "differs";
}

/** The distinctive words of a setting ("rural Thailand" → ["rural", "thailand"]), for loose text matching. */
export function settingWords(setting: string): string[] {
  return setting.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w));
}
const STOP = new Set(["with", "from", "and", "the", "care", "health", "setting", "settings", "country", "countries", "patients", "people", "based"]);

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };

/**
 * The publication years a scoping timeframe answer asks for, or null when it names none. "Last 5 years" in 2026
 * is 2021 to now (the current year minus 5, as PubMed's own "5 years" filter counts back from today), never a
 * year guessed by the AI. `yearTo` null means "up to now".
 */
export function yearsFromTimeframe(timeframe: string | null | undefined, now = new Date().getFullYear()): { yearFrom: number; yearTo: number | null } | null {
  const t = timeframe?.toLowerCase().trim() ?? "";
  if (!t) return null;
  const range = t.match(/\b((?:19|20)\d{2})\s*(?:-|–|—|to|until|through)\s*((?:19|20)\d{2}|now|present|today|date)\b/);
  if (range) {
    const to = /^\d/.test(range[2]) ? Number(range[2]) : null;
    return { yearFrom: Math.min(Number(range[1]), to ?? Number(range[1])), yearTo: to === null || to >= now ? null : Math.max(Number(range[1]), to) };
  }
  const since = t.match(/\b(?:since|from|after)\s+((?:19|20)\d{2})\b/);
  if (since) return { yearFrom: Number(since[1]) + (/\bafter\b/.test(t) ? 1 : 0), yearTo: null };
  const last = t.match(/\b(?:last|past|previous|recent|most recent)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s+years?\b/);
  const n = last ? (/^\d/.test(last[1]) ? Number(last[1]) : WORD_NUMBERS[last[1]]) : /\b(?:last|past|previous)\s+decade\b/.test(t) ? 10 : null;
  if (n && n > 0 && n <= 50) return { yearFrom: now - n, yearTo: null };
  return null;
}

/**
 * MeSH headings typed one per line (or separated by semicolons). Commas stay inside a heading, because real
 * headings contain them ("Asia, Southeastern"); `meshText` writes a list back the same way.
 */
export function splitHeadings(s: string): string[] {
  return [...new Set(s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean))];
}
export const meshText = (terms: string[]) => terms.join("\n");
