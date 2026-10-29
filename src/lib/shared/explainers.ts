// The three beats of each stage's "What happens in this step" explainer. The videos (public/explainers/,
// rendered from remotion/StageExplainer.tsx) show these lines; the app also shows them as text, so the
// explanation never depends on watching the video.
export const EXPLAINERS: { title: string; beats: [string, string, string] }[] = [
  { title: "Describe your idea", beats: ["Write your idea in a sentence, however rough.", "Athena asks up to five short questions to sharpen it.", "Nothing moves on until you approve it."] },
  { title: "Turn it into search topics", beats: ["Your answers become 4–8 search topics.", "Each topic gets synonyms and MeSH terms (PubMed's official keywords).", "Accept, edit or delete any topic."] },
  { title: "Check the database searches", beats: ["Each topic becomes a search for PubMed and OpenAlex.", "A dry run counts the hits before anything is fetched.", "Edit any search; you approve before it runs."] },
  { title: "Collect the papers", beats: ["Every search runs on the real databases.", "Papers found more than once are merged.", "You see how many came from where, and any failures."] },
  { title: "Skim the summary table", beats: ["One row per paper.", "The AI drafts study type, setting and key finding from each abstract.", "Correct any cell; every edit is logged."] },
  { title: "Rank and pick papers", beats: ["Each paper is scored on a visible rubric.", "The top 3–5 per topic are selected for you.", "Swap in any paper you prefer."] },
  { title: "Appraise the selected papers", beats: ["Each paper is read: open full text if legal, otherwise the abstract.", "Every claim carries a quote, checked word for word.", "Quotes that cannot be found stay flagged until you decide."] },
  { title: "See what the evidence says", beats: ["Claims are grouped by topic.", "Into what is known, contested and still unknown.", "Every statement links back to its quotes."] },
  { title: "Choose your research question", beats: ["Three candidate questions, each from a gap.", "Each has its feasibility, main weakness and a novelty search.", "Pick one, edit it, and export your review."] },
];
