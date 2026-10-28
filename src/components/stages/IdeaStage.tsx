"use client";
import { useEffect, useState } from "react";
import { api, projectPath } from "../api";
import { ErrorState, Spinner } from "../ui";
import { useWizard } from "../wizard/Wizard";

export function IdeaStage() {
  const { project, projectId, refresh, confirmEdit, states, approve } = useWizard();
  const [idea, setIdea] = useState(project.idea);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    setIdea(project.idea);
  }, [project.idea]);
  const dirty = idea.trim() !== project.idea.trim();

  async function save(andApprove = false) {
    setErr(null);
    if (dirty) {
      if (!(await confirmEdit(1))) return;
      setSaving(true);
      try {
        await api(projectPath(projectId, "idea"), { method: "PATCH", body: { idea } });
        await refresh();
      } catch (e) {
        setErr(e);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    if (andApprove) await approve(1);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-5">
        <label htmlFor="idea-edit" className="label">Your research idea</label>
        <textarea
          id="idea-edit"
          className="input min-h-36 text-base leading-relaxed"
          value={idea}
          placeholder="e.g. What is the knowledge gap in implementing telemedicine in Southeast Asia?"
          onChange={(e) => setIdea(e.target.value)}
        />
        <p className="mt-2 text-xs text-gray-500">Write it the way you would explain it to a supervisor. It does not need to be a polished question yet — the next step will help you scope it.</p>
        {err ? <div className="mt-3"><ErrorState error={err} /></div> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {dirty && <button className="btn-secondary" onClick={() => setIdea(project.idea)} disabled={saving}>Undo changes</button>}
          {dirty && states["1"] === "approved" && <button className="btn-secondary" onClick={() => save(false)} disabled={saving}>{saving && <Spinner />} Save changes</button>}
          {states["1"] !== "approved" && (
            <button className="btn-primary" onClick={() => save(true)} disabled={saving || idea.trim().length < 10}>
              {saving && <Spinner />} Save and start scoping →
            </button>
          )}
        </div>
      </div>
      <div className="rounded-xl bg-[var(--color-accent-soft)] p-4 text-sm text-teal-950">
        <p className="font-semibold">How this works</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Every AI suggestion appears as a draft you can edit before anything else runs.</li>
          <li>Every paper comes from a real database record (PubMed or OpenAlex) with its identifier — the AI never adds references from memory.</li>
          <li>Every extracted finding carries a quote that the app checks against the text it actually retrieved.</li>
        </ul>
      </div>
    </div>
  );
}
