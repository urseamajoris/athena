"use client";
import { useEffect, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Button, Card } from "../ui";
import { noCredits } from "../credits";
import { Section, StepActions, StepFrame, useSession, type QuestionDraft } from "../workspace";
import { IdeaPanel, type ScopingData } from "../panels/IdeaPanel";

/**
 * Stage 2, the research question. Hosts the short conversation (panels/IdeaPanel, chat only) and, under it, the
 * working question: pick a suggested wording or write your own, then confirm.
 *
 * Server contract used here: POST question/draft (AI: writes `project.questionDrafts`), PUT question { text,
 * framework?, structure? } (saves `project.question`), POST stages/2/approve (needs a question).
 */
export function QuestionStep() {
  const { projectId, project, refresh, confirmEdit, track, run, busy, actionFor, pending, ai, credits } = useSession();
  // The banner under the headline says why AI cannot run; the button that needs it is not offered meanwhile.
  const canAi = ai.enabled && !ai.keyMissing && !ai.budgetReached && !noCredits(credits);
  const { data: scoping } = useApi<ScopingData>(projectPath(projectId, "scoping"));
  const saved = (project.question ?? "").trim();
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(saved), [saved]);
  const drafts: QuestionDraft[] = Array.isArray(project.questionDrafts) ? project.questionDrafts : [];
  const chatOpen = !!scoping && !scoping.done && scoping.messages.length > 0;
  const action = actionFor("question");
  const dirty = text.trim() !== saved;

  async function save(draft?: QuestionDraft): Promise<boolean> {
    const body = draft ? { text: draft.text, framework: draft.framework, structure: draft.structure } : { text: text.trim() };
    if (!body.text) {
      setError("Write your research question first.");
      return false;
    }
    if (!draft && !dirty) return true;
    if (!(await confirmEdit(2))) return false;
    setSaving(true);
    setError(null);
    try {
      await api(projectPath(projectId, "question"), { method: "PUT", body });
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function draftWithAi() {
    setError(null);
    try {
      await track("Drafting your research question", () => api(projectPath(projectId, "question/draft"), { body: {} }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <StepFrame step="question">
      <Section title="A few short questions" description={`About your idea: “${project.idea}”`}>
        <IdeaPanel chatOnly />
      </Section>

      <Section title="Your research question" description="Pick a suggested wording, or write your own. You can change it until you confirm.">
        {drafts.length > 0 && (
          <ul className="mb-4 space-y-3">
            {drafts.map((d, i) => (
              <Card as="li" key={i} className="flex flex-wrap items-start gap-x-4 gap-y-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-medium text-fg-0">{d.text}</p>
                  {d.note && <p className="mt-1 text-small text-fg-1">{d.note}</p>}
                </div>
                <Button onClick={() => save(d)} aria-disabled={saving || undefined}>Use this wording</Button>
              </Card>
            ))}
          </ul>
        )}
        <label htmlFor="question" className="label">Research question</label>
        <textarea id="question" rows={3} className="input min-h-24 resize-y" value={text} onChange={(e) => { setText(e.target.value); setError(null); }} placeholder="For example: In university students, is shorter sleep associated with lower exam grades?" />
        {error && <p role="alert" className="mt-2 text-small font-medium text-err">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {dirty && <Button onClick={() => save()} busy={saving}>Save this question</Button>}
          {canAi && <Button onClick={draftWithAi} aria-disabled={!!pending || undefined}>{drafts.length ? "Draft 3 new wordings" : "Draft 3 wordings with AI"}</Button>}
        </div>
      </Section>

      {/* While a question from the conversation waits for an answer, the conversation's own button is the primary one. */}
      {action && !chatOpen && (
        <StepActions
          primary={{ label: action.label, busy: saving || !!busy, awaitInput: !text.trim(), onClick: async () => { if (await save()) await run(action.cmd); } }}
          next={action.next}
        />
      )}
    </StepFrame>
  );
}
