"use client";
import { useEffect, useState } from "react";
import { api, projectPath } from "../api";
import { Button } from "../ui";
import { StepActions, StepFrame, useSession } from "../workspace";

export const IDEA_EXAMPLES = [
  "Does sleep affect exam grades in university students?",
  "What helps nurses stay in rural hospitals?",
  "How does telemedicine work for older patients in Southeast Asia?",
];
export const IDEA_MIN = 10;

/** The one text box of the idea screen, with examples to click. Shared with the new-review page. */
export function IdeaField({ value, onChange, error, examples = true, autoFocus = false }: { value: string; onChange: (v: string) => void; error?: string | null; examples?: boolean; autoFocus?: boolean }) {
  return (
    <div>
      <label htmlFor="idea" className="label">Your idea</label>
      <textarea
        id="idea"
        rows={5}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby="idea-hint"
        aria-invalid={!!error || undefined}
        placeholder="For example: Does sleep affect exam grades?"
        className="input min-h-36 resize-y px-4 py-3"
      />
      <p id="idea-hint" className="mt-2 text-small text-fg-2">It does not need to be a polished question. Athena helps you turn it into one next.</p>
      {error && <p role="alert" className="mt-2 text-small font-medium text-err">{error}</p>}
      {examples && (
        <div className="mt-6">
          <p className="text-small font-semibold text-fg-0">Or start from an example</p>
          <ul className="mt-2 flex flex-col items-start gap-2">
            {IDEA_EXAMPLES.map((x) => (
              <li key={x}><button type="button" className="btn-secondary h-auto min-h-10 whitespace-normal rounded-full px-4 text-left font-medium" onClick={() => onChange(x)}>{x}</button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Stage 1, the idea: read it, change it, continue. */
export function IdeaStep() {
  const { projectId, project, refresh, confirmEdit, run, busy, actionFor } = useSession();
  const [idea, setIdea] = useState(project.idea);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setIdea(project.idea), [project.idea]);
  const dirty = idea.trim() !== project.idea.trim();
  const action = actionFor("idea");

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    if (idea.trim().length < IDEA_MIN) {
      setError("Write at least a sentence about your idea.");
      return false;
    }
    if (!(await confirmEdit(1))) return false;
    setSaving(true);
    setError(null);
    try {
      await api(projectPath(projectId, "idea"), { method: "PATCH", body: { idea } });
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <StepFrame step="idea">
      <IdeaField value={idea} onChange={(v) => { setIdea(v); setError(null); }} error={error} examples={false} />
      {dirty && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} busy={saving}>Save changes</Button>
          <Button variant="quiet" onClick={() => { setIdea(project.idea); setError(null); }}>Undo</Button>
        </div>
      )}
      {action && (
        <StepActions
          primary={{ label: action.label, busy: saving || !!busy, awaitInput: idea.trim().length < IDEA_MIN, disabledReason: undefined, onClick: async () => { if (await save()) await run(action.cmd); } }}
          next={action.next}
        />
      )}
    </StepFrame>
  );
}
