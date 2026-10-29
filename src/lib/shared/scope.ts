// The idea's scope as the scoping answers set it (where, and which years), and how papers and searches compare to
// it. Pure: used by the search builder and ranking on the server and by the panels in the browser (unit-tested).
import { placeTerms, placesIn } from "./places";

/** Scoping answers that mean "no limit" rather than a place, as the whole answer. */
const NO_SETTING = /^(?:not specified|not stated|unspecified|none|any|anywhere|n\/?a|no preference|global|worldwide|international|all countries|any setting|any country)\.?$/i;
/** Wording that means "no limit" anywhere in the answer: "not specified (any country)", "hospitals … globally". */
const NO_LIMIT = /\b(?:not specified|unspecified|not stated|no specific|not limited|no (?:geographic )?restrictions?|any (?:country|countries|setting|settings|location|region|place)|anywhere|global(?:ly)?(?! south| north)|worldwide|international(?:ly)?|all countries|no preference)\b/i;

/**
 * The idea's setting (a country, a region, a care setting) from the scoping summary, or null when it has none. An
 * answer that says it has no limit ("not specified (any country)", "hospitals and other healthcare settings
 * globally") has none, unless it also names a country.
 */
export function ideaSetting(summary: Record<string, string> | null | undefined): string | null {
  const s = summary?.setting?.trim();
  if (!s || NO_SETTING.test(s)) return null;
  const bare = s.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim() || s; // "not specified (any country)" → "not specified"
  return NO_SETTING.test(bare) || (NO_LIMIT.test(bare) && !placesIn(bare).size) ? null : s;
}

// Words that name a kind of care or place of study, not where in the world it is.
const CARE = new Set(
  ("hospital clinic care primary secondary tertiary health healthcare setting ward icu intensive unit nursing home " +
    "community school university college workplace pharmacy practice general centre center facility outpatient " +
    "inpatient emergency department service long term residential acute other and or the in of at on based")
    .split(" "),
);

/**
 * Whether a setting is a place (a country, a region, a city, "rural Kenya") rather than only a kind of care setting
 * ("hospitals", "primary care"). Every search is limited to a place; a care setting is left to the AI's queries.
 */
export function placeLike(setting: string): boolean {
  return placesIn(setting).size > 0 || words(setting).some((w) => !CARE.has(w));
}

/**
 * The setting a topic's papers are scored against: none when the topic compares the idea's setting with other
 * settings (its searches were not limited to it), so papers from elsewhere keep their score there.
 */
export function rankedSetting(setting: string | null, topicQueries: { scope: { comparesSettings: boolean } | null }[]): string | null {
  return topicQueries.some((q) => q.scope?.comparesSettings) ? null : setting;
}

/**
 * Whether a paper is set in the idea's setting, as far as the abstract shows. `settingMatch` is the AI's 0–5
 * rating from ranking (3 or more: in the setting, alone or among other places); without it, the paper's own
 * setting text is checked for the setting (see mentionsSetting). Fuzzy by nature, so the panels word it as
 * "check", not a verdict.
 */
export type SettingFit = "match" | "differs" | "not_reported";
export function settingFit(setting: string, paperSetting: string | null | undefined, settingMatch?: number | null): SettingFit {
  const text = paperSetting?.trim() ?? "";
  if (typeof settingMatch === "number" && settingMatch >= 3) return "match";
  if (!text || /^not (?:reported|stated|clear)/i.test(text)) return "not_reported";
  if (typeof settingMatch === "number") return "differs";
  return mentionsSetting(setting, text) ? "match" : "differs";
}

/**
 * Whether a text (a paper's setting, a search query) names the idea's setting. A setting that names a country
 * needs that country, by any of its names ("Thai[tiab]" names Thailand; "United Kingdom" is not "United States";
 * "rural Kenya" is not "rural India"). Otherwise every distinctive word of the setting must be there as a whole
 * word ("primary care" is not "primary schools"), except modifiers such as "rural" next to a place name.
 */
export function mentionsSetting(setting: string, text: string): boolean {
  const ours = placesIn(setting);
  if (ours.size) return [...placesIn(text)].some((x) => ours.has(x));
  const need = settingWords(setting);
  const have = new Set(words(text));
  return need.length > 0 && need.every((w) => have.has(w));
}

/** The distinctive words of a setting that names no country ("rural Ontario" → ["ontario"]), singular. */
function settingWords(setting: string): string[] {
  const all = words(setting).filter((w) => !STOP.has(w));
  const heads = all.filter((w) => !MODIFIER.has(w));
  return heads.length ? heads : all;
}
const STOP = new Set(["with", "from", "and", "or", "the", "in", "of", "at", "on", "for", "a", "an", "setting", "country", "patient", "people", "based", "area", "region", "other"]);
const MODIFIER = new Set(["rural", "urban", "remote", "suburban", "northern", "southern", "eastern", "western", "central", "north", "south", "east", "west"]);
/** Lower-case whole words, singular ("Hospitals, pharmacies" → ["hospital", "pharmacy"]), without field tags. */
const words = (s: string) =>
  s.replace(/\[[^\]]*\]/g, " ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => (w.length > 4 ? w.replace(/ies$/, "y").replace(/(?<!s)s$/, "") : w));

/** The words a search block is built from when the AI gave none: a country's names, else the setting's own words. */
export function settingTerms(setting: string): string[] {
  const names = placeTerms(setting);
  return names.length ? names : settingWords(setting);
}

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };

/**
 * The publication years a scoping timeframe answer asks for, or null when it names none. "Last 5 years" in 2026
 * is 2021 to now (the current year minus 5, as PubMed's own "5 years" filter counts back from today), never a
 * year guessed by the AI. `yearTo` null means "up to now". "Last N years" wins over a range written next to it:
 * "last 10 years (2015-2025)" asked in 2026 is 2016 to now, not a range that stops last year.
 */
export function yearsFromTimeframe(timeframe: string | null | undefined, now = new Date().getFullYear()): { yearFrom: number; yearTo: number | null } | null {
  const t = timeframe?.toLowerCase().trim() ?? "";
  if (!t) return null;
  const last = t.match(/\b(?:last|past|previous|recent|most recent)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s+years?\b/);
  const n = last ? (/^\d/.test(last[1]) ? Number(last[1]) : WORD_NUMBERS[last[1]]) : /\b(?:last|past|previous)\s+decade\b/.test(t) ? 10 : null;
  if (n && n > 0 && n <= 50) return { yearFrom: now - n, yearTo: null };
  const range = t.match(/\b((?:19|20)\d{2})\s*(?:-|–|—|to|until|through)\s*((?:19|20)\d{2}|now|present|today|date)\b/);
  if (range) {
    const to = /^\d/.test(range[2]) ? Number(range[2]) : null;
    return { yearFrom: Math.min(Number(range[1]), to ?? Number(range[1])), yearTo: to === null || to >= now ? null : Math.max(Number(range[1]), to) };
  }
  const since = t.match(/\b(?:since|from|after)\s+((?:19|20)\d{2})\b/);
  if (since) return { yearFrom: Number(since[1]) + (/\bafter\b/.test(t) ? 1 : 0), yearTo: null };
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
