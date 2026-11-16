"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../api";
import { StepActions, StepFrame, WorkspaceLayout } from "../workspace";
import { IDEA_MIN, IdeaField } from "./IdeaStep";

/**
 * /s/new: the idea screen before a review exists. The same frame as every screen, with the rail showing the
 * whole journey. "Start my review" creates the review, confirms the idea and opens the Question screen.
 */
export function NewReview() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = idea.trim().length < IDEA_MIN;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (tooShort) return setError("Write at least a sentence about your idea.");
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/projects", { body: { idea } });
      // The idea is confirmed straight away, so the review opens on the next screen. If that fails the review
      // opens on its idea screen, which offers the same step.
      await api(`/api/projects/${id}/stages/1/approve`, { body: {} }).catch(() => {});
      router.replace(`/s/${id}`);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  return (
    <WorkspaceLayout rail={{ states: {}, open: "idea" }}>
      <StepFrame step="idea">
        <form id="new-review" onSubmit={create} noValidate>
          <IdeaField value={idea} onChange={(v) => { setIdea(v); setError(null); }} error={error} autoFocus />
        </form>
        <StepActions primary={{ label: "Start my review", form: "new-review", busy, awaitInput: tooShort }} next="Next: a few short questions turn your idea into a research question. Starting a review uses no credits." />
      </StepFrame>
    </WorkspaceLayout>
  );
}
