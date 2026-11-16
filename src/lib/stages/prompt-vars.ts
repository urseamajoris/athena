// The variables each prompt file (prompts/<name>.vN.md) uses as {{placeholders}}. Call sites type their `vars`
// with PromptVars<"name">, so the compiler checks that every placeholder is supplied; prompt-vars.test.ts checks
// this list against the placeholders in the latest version of each file.
export const PROMPT_VARS = {
  scoping_turn: ["idea", "transcript", "asked", "maxQuestions"],
  question_draft: ["idea", "transcript"],
  scoping_topics: ["question", "idea", "transcript", "existing", "minTopics", "maxTopics"],
  search_builder: ["question", "idea", "summary", "topics", "otherTopics", "databases", "syntax"],
  paper_summary: ["question", "papers"],
  ranking: ["question", "idea", "summary", "topic", "papers"],
  topic_importance: ["question", "idea", "topics"],
  appraisal: ["question", "textSource", "textNote", "template", "fields", "checklist", "paperId", "title", "year", "text"],
  synthesis: ["question", "idea", "topic", "papers", "claims"],
  research_questions: ["question", "idea", "summary", "topics", "synthesis", "claims"],
} as const;

export type PromptName = keyof typeof PROMPT_VARS;
export type PromptVars<N extends PromptName> = Record<(typeof PROMPT_VARS)[N][number], string>;
