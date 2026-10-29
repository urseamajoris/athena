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

/** "Appraise selected papers" while a topic has fewer than 3 papers: say which, and what that means. */
export function ThinTopicsDialog({ topics, onCancel, onConfirm }: { topics: { name: string; selected: number }[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={`${topics.length === 1 ? "A topic has" : `${topics.length} topics have`} fewer than ${PER_TOPIC.min} papers`}
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel}>Go back and pick papers</button>
          <button className="btn-primary" onClick={onConfirm}>Appraise anyway</button>
        </>
      }
    >
      <ul className="mb-3 list-disc space-y-1 pl-5">
        {topics.map((t) => <li key={t.name}><strong className="font-semibold">{t.name}</strong>: {t.selected === 0 ? "no papers" : `${t.selected} paper${t.selected === 1 ? "" : "s"}`} selected</li>)}
      </ul>
      <p>Only the selected papers are appraised, so {topics.length === 1 ? "this topic" : "these topics"} will have little or no evidence in the next steps. This usually means few of the papers found match the topic. You can tick more papers in the topic’s view first, or go on.</p>
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

