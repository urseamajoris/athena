// The 3-second reading of every Focus panel: which step this is, what the page is for, what to do now,
// and what comes next. Pure (unit-tested); the intended readings are recorded in docs/ux-intent.md.
import { STAGES, type StageState } from "../shared/stages";
import type { GNode, GraphInput } from "./graph";
import { frontierStage, isGhostTopic, st } from "./graph";

export interface Task {
  /** "Step 5 of 9" (null for the finished review). */
  step: number | null;
  /** The task, in plain words: what this page is for. */
  headline: string;
  /** One sentence: what to do now (or what is happening). */
  help: string;
  /** What comes after this step, for the "where am I" line. */
  next: string | null;
}

const nextTitle = (n: number) => (n < 9 ? `Next: step ${n + 1}, ${STAGES[n].title.toLowerCase()}` : "Next: download your review");

/** The stage a node's panel is about right now (the Table node holds 5 and 6). */
export function nodeStage(node: GNode, states: Record<string, StageState>): number {
  if (node.kind === "table") return st(states, 5) === "approved" ? 6 : 5;
  if (node.kind === "idea") return st(states, 1) === "approved" ? 2 : 1;
  return node.stages[0] ?? 1;
}

export function taskFor(node: GNode, input: GraphInput): Task {
  const { states, summary: s } = input;
  const n = nodeStage(node, states);
  const state = st(states, n);
  const frontier = frontierStage(states);
  const base = { step: n, next: nextTitle(n) };
  if (state === "stale") return { ...base, headline: "This step is out of date", help: "Something earlier changed after these results were made. You can still read them; the notice below says what to do." };
  if (state === "failed") return { ...base, headline: "This step did not finish", help: "Read what went wrong below, then try again." };
  switch (node.kind) {
    case "idea": {
      if (st(states, 1) !== "approved") return { ...base, step: 1, headline: "Tell us what you want to research", help: "Write your idea in a sentence or two, the way you would say it to a supervisor. It does not need to be a polished question.", next: "Next: a few short questions to sharpen it" };
      const topics = s?.topics ?? [];
      if (!topics.length && !s?.scoping.done) return { ...base, headline: "Answer a few questions to sharpen your idea", help: `Athena asks up to ${5} short questions about who, where and what you want to know. Answer in your own words, or skip any time.`, next: "Next: your answers become search topics" };
      if (!topics.length) return { ...base, headline: "Turn your answers into search topics", help: "Athena will suggest 4–8 search topics from your answers. You can edit every one." };
      const ghosts = topics.filter((t) => isGhostTopic(t, states, input.client.acceptedTopics));
      if (ghosts.length) return { ...base, headline: "Keep the search topics you want", help: `${ghosts.length} suggested topic${ghosts.length === 1 ? " is" : "s are"} waiting. Keep them, edit them, or delete the ones that do not fit.` };
      if (st(states, 2) !== "approved") return { ...base, headline: "Check your search topics, then approve them", help: `Aim for 4–8 topics. Open a topic to edit its name and synonyms. You have ${topics.length}.` };
      return { ...base, headline: "Your idea and its scope", help: "Approved. Edit the idea or topics any time; later steps will then be marked out of date." };
    }
    case "topic": {
      const t = s?.topics.find((x) => x.id === node.topicId);
      if (t && isGhostTopic(t, states, input.client.acceptedTopics)) return { ...base, step: 2, headline: "Keep or delete this suggested topic", help: "Suggested from your answers. Keep it if it is part of your question; you can edit it after." };
      return { ...base, step: 2, headline: "Edit this search topic", help: "Its name, synonyms and MeSH terms (PubMed's official keywords) decide what the searches find." };
    }
    case "query":
      if (!s?.queries.length) return { ...base, headline: "Turn the topics into database searches", help: "Athena writes one search per topic for PubMed and for OpenAlex. You can read and edit each one." };
      if (state === "approved") return { ...base, headline: "The searches for this topic", help: "These searches have run. Editing one marks the later steps out of date." };
      return { ...base, headline: "Check the searches before they run", help: "Each topic is searched in PubMed and OpenAlex. The counts show how many papers each search would find. Run them when they look right." };
    case "corpus":
      if (state === "running") return { ...base, headline: "Collecting papers from PubMed and OpenAlex", help: "This runs on the server; you can close the page. Papers found twice are merged as they arrive." };
      return { ...base, headline: "Check what was found, then summarise the papers", help: "See how many papers each database returned and how many were duplicates. Then let the AI summarise each abstract." };
    case "table":
      if (n === 5 && state === "running") return { ...base, headline: "Summarising every paper", help: "The AI reads each abstract and drafts its study type, setting and key finding. You can browse the table meanwhile." };
      if (n === 5) return { ...base, headline: "Skim the papers and fix any wrong cells", help: "Each row is drafted by the AI from the abstract only. Correct anything that looks wrong, then rank the papers." };
      if (state === "running") return { ...base, headline: "Scoring the papers", help: "Each paper is scored against your topics on a visible rubric. The best few per topic are pre-selected." };
      return { ...base, headline: "Check which papers go forward", help: "The top 3–5 papers per topic are selected for appraisal. Swap any you disagree with, then appraise them." };
    case "appraisal":
      if (state === "running") return { ...base, headline: "Reading the selected papers", help: "Each paper is appraised on its open full text where that is legal, otherwise on its abstract. Quotes are checked word for word." };
      return { ...base, headline: "Check each paper's appraisal", help: "Go through the papers one by one. Look at the quality checklist and decide on any quote marked unverified." };
    case "synthesis":
      if (state === "running") return { ...base, headline: "Writing the synthesis", help: "Claims from the appraisals are grouped into what is known, contested and still unknown." };
      return { ...base, headline: "Read what the evidence says", help: "What is known, contested and unknown, each linked to its quotes. Edit any statement, then ask for research questions." };
    case "questions":
      if (state === "running") return { ...base, headline: "Drafting research questions", help: "Three candidates are drafted from the gaps in the synthesis, and each one is checked for novelty in the databases." };
      if (state === "approved") return { ...base, headline: "Your research question", help: "Chosen and approved. Download your review below, or edit the question again." };
      return { ...base, headline: "Choose your research question", help: "Compare the three candidates. Each shows the gap it fills, its feasibility and its main weakness. Pick one; you can edit it." };
    case "export":
      return { step: null, headline: "Download your literature review", help: "The report, the summary table and the references of your selected papers.", next: null };
    case "quote":
      return { ...base, step: 7, headline: "Check this quote against its source", help: "The quote is shown next to the passage it should come from. Accept or reject it if the check could not find it." };
  }
  return { ...base, headline: STAGES[n - 1]?.title ?? "", help: frontier ? STAGES[frontier - 1].done : "" };
}
