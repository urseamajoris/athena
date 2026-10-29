// Countries named in free text (a scoping setting, a paper's title or setting, a search query), matched as whole
// words: "Indiana" is not India, "usability" is not the USA and "woman" is not Oman. Pure (unit-tested in
// places.test.ts); shared by the novelty check, the setting checks and the search builder.

// One country per comma-separated entry: its names, adjectives and other names ("_" joins the words of a name).
// Regions ("Asia", "Latin America") are left out: they contain the countries. "Spanish", "French" and the like
// count only when they do not name a language ("Spanish-speaking adults" are not in Spain).
const ENTRIES = (
  "afghanistan afghan, albania albanian, algeria algerian, argentina argentine argentinian, australia australian, " +
  "austria austrian, bangladesh bangladeshi, belgium belgian, bhutan bhutanese, bolivia bolivian, brazil brazilian, " +
  "bulgaria bulgarian, cambodia cambodian, cameroon cameroonian, canada canadian, chile chilean, china chinese, " +
  "colombia colombian, croatia croatian, cuba cuban, czech czechia, denmark danish, ecuador ecuadorian, egypt egyptian, " +
  "ethiopia ethiopian, finland finnish, france french, germany german, ghana ghanaian, greece greek, hungary hungarian, " +
  "india indian, indonesia indonesian, iran iranian, iraq iraqi, ireland irish, israel israeli, italy italian, " +
  "japan japanese, jordan jordanian, kenya kenyan, korea korean, kuwait kuwaiti, laos lao laotian, lebanon lebanese, " +
  "malawi malawian, malaysia malaysian, mexico mexican, mongolia mongolian, morocco moroccan, myanmar burmese, " +
  "nepal nepali nepalese, netherlands dutch, new_zealand zealand, nigeria nigerian, norway norwegian, oman omani, " +
  "pakistan pakistani, palestine palestinian, peru peruvian, philippines philippine filipino, poland polish, " +
  "portugal portuguese, qatar qatari, romania romanian, russia russian, rwanda rwandan, saudi_arabia saudi, " +
  "serbia serbian, singapore singaporean, slovenia slovenian, south_africa south_african, spain spanish, " +
  "sri_lanka lanka lankan, sudan sudanese, sweden swedish, switzerland swiss, syria syrian, taiwan taiwanese, " +
  "tanzania tanzanian, thailand thai, tunisia tunisian, turkey turkish, uganda ugandan, ukraine ukrainian, " +
  "united_arab_emirates emirates uae, united_kingdom uk britain great_britain british england scotland scottish wales welsh, " +
  "united_states usa america american, vietnam vietnamese, yemen yemeni, zambia zambian, zimbabwe zimbabwean"
)
  .split(", ")
  .map((entry) => entry.split(" ").map((w) => w.replace(/_/g, " ")));
const USA = ENTRIES.findIndex((e) => e[0] === "united states");
const UK = ENTRIES.findIndex((e) => e[0] === "united kingdom");

/** The words of a text, lower-case, one space apart and padded with spaces, for whole-word and phrase lookups. */
const spaced = (s: string) => ` ${s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ")} `;

/** The countries a text names, as entry numbers (compare them, do not show them). */
export function placesIn(text: string): Set<number> {
  const found = new Set<number>();
  // "US" and "U.S." in capitals only ("give us a voice" is not the USA); "UK" and "U.K." likewise.
  if (/(?<![\p{L}\p{N}])U\.?\s?S\.?(?:\s?A\.?)?(?![\p{L}\p{N}])/u.test(text)) found.add(USA);
  if (/(?<![\p{L}\p{N}])U\.?\s?K\.?(?![\p{L}\p{N}])/u.test(text)) found.add(UK);
  const t = spaced(
    text
      .replace(/\b[a-z]+[\s-]+(?:speaking|speakers?|language)\b/gi, " ") // a language, not a country
      .replace(/\b(?:latin|south|central|north)[\s-]+americans?\b|\bthe americas\b/gi, " ") // regions
      .replace(/\b(?:american|alaska)[\s-]+(?:indians?|natives?)\b|\bnative[\s-]+americans?\b/gi, " american "),
  );
  ENTRIES.forEach((names, i) => {
    if (names.some((n) => t.includes(` ${n} `) || t.includes(` ${n}s `))) found.add(i);
  });
  return found;
}

/** The names and adjectives of the countries a text names ("rural Thailand" → ["thailand", "thai"]), for a search block. */
export function placeTerms(text: string): string[] {
  return [...placesIn(text)].flatMap((i) => ENTRIES[i]);
}
