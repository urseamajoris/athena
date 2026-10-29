"use client";
import { useEffect, useState } from "react";
import { api, projectPath } from "../api";
import { Spinner } from "../ui";
import { Modal } from "../overlays";
import { canvasStore, useSession } from "./SessionContext";
import { PER_TOPIC, STAGES } from "@/lib/shared/stages";
import type { Pos } from "@/lib/canvas/layout";

/** "Edit an earlier step?" — later steps would go stale. */
export function ConfirmEditDialog({ downstream, onCancel, onConfirm }: { downstream: number[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Edit an earlier step?"
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={onConfirm}>Edit and mark later steps stale</button>
        </>
      }
    >
      <p>
        Later steps ({downstream.map((n) => STAGES[n - 1].title).join(", ")}) were built from the current version of this step. If you change it, they will be marked
        <strong> out of date</strong>. Nothing is re-run automatically: use “Bring later steps up to date” when you are ready.
      </p>
    </Modal>
  );
}

/** "Appraise selected papers" while a topic has fewer than 3 papers: say which, why, and the ways to recover. */
export function ThinTopicsDialog({ topics, onCancel, onEditSearches, onConfirm }: { topics: { name: string; selected: number; matching: number; spare: number }[]; onCancel: () => void; onEditSearches: () => void; onConfirm: () => void }) {
  const canPick = topics.some((t) => t.spare > 0);
  const fewMatch = topics.filter((t) => t.spare === 0);
  return (
    <Modal
      open
      onClose={onCancel}
      title={`${topics.length === 1 ? "A topic has" : `${topics.length} topics have`} fewer than ${PER_TOPIC.min} papers`}
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel}>Go back and pick papers</button>
          <button className="btn-secondary" onClick={onEditSearches}>Edit the searches (step 3)</button>
          <button className="btn-primary" onClick={onConfirm}>Appraise anyway</button>
        </>
      }
    >
      <ul className="mb-3 list-disc space-y-1 pl-5">
        {topics.map((t) => (
          <li key={t.name}>
            <strong className="font-semibold">{t.name}</strong>: {t.selected === 0 ? "no papers" : `${t.selected} paper${t.selected === 1 ? "" : "s"}`} selected
            {t.spare > 0 ? `; ${t.spare} more match${t.spare === 1 ? "es" : ""} the topic` : t.matching === 0 ? "; no papers match the topic" : `; only ${t.matching} match${t.matching === 1 ? "es" : ""} the topic`}
          </li>
        ))}
      </ul>
      <p>
        Only the selected papers are appraised, so {topics.length === 1 ? "this topic" : "these topics"} will have little or no evidence in the next steps.
        {canPick && " You can tick more matching papers in the topic’s view first."}
        {fewMatch.length > 0 && ` Few of the papers found match ${fewMatch.length === 1 ? `“${fewMatch[0].name}”` : "some topics"}: to find more, change the search words in step 3, then bring the later steps up to date.`}
      </p>
    </Modal>
  );
}

/** "Summarise with quotes undecided?" — the synthesis leaves undecided quotes out. */
export function ConfirmLeaveOutDialog({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const n = `${count} quote${count === 1 ? "" : "s"}`;
  return (
    <Modal
      open
      onClose={onCancel}
      title={`${n} not decided yet`}
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel}>Go back and decide</button>
          <button className="btn-primary" onClick={onConfirm}>Summarise without them</button>
        </>
      }
    >
      <p>
        {n} you have not decided will be left out of the synthesis. The check could not find {count === 1 ? "it" : "them"} word for word in the paper. Accept a quote if the
        paper does say it, and it will be used.
      </p>
    </Modal>
  );
}

export function AddTopicDialog({ state, onClose }: { state: { flowAt?: Pos } | null; onClose: () => void }) {
  const { projectId, refresh, confirmEdit, announce } = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (state) {
      setName("");
      setErr(null);
    }
  }, [state]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (!(await confirmEdit(2))) return;
      const r = await api<{ id: string }>(projectPath(projectId, "topics"), { body: { name } });
      const st = canvasStore.getState();
      if (state?.flowAt) st.pinPosition(projectId, `topic:${r.id}`, state.flowAt);
      await refresh();
      st.select(`topic:${r.id}`);
      announce(`Topic “${name}” added.`);
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!state} onClose={onClose} title="Add a topic">
      <form onSubmit={submit} className="space-y-3" id="add-topic-form">
        <label htmlFor="new-topic-name" className="label">Topic name</label>
        <input id="new-topic-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cost and financing" />
        {err && <p role="alert" className="text-err">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim()}>{busy && <Spinner />} Add topic</button>
        </div>
      </form>
    </Modal>
  );
}

