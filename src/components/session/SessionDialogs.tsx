"use client";
import { Button } from "../ui";
import { Modal } from "../overlays";
import { PER_TOPIC } from "@/lib/shared/stages";

/** "Change this?": later screens were made from it and would go out of date. */
export function ConfirmEditDialog({ later, onCancel, onConfirm }: { later: string[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Change this? Later screens will be out of date"
      footer={
        <>
          <Button variant="quiet" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm}>Change it</Button>
        </>
      }
    >
      <p>
        {later.length === 1 ? "A later screen" : "Later screens"} ({later.join(", ")}) {later.length === 1 ? "was" : "were"} made from what is here now. If you change it, {later.length === 1 ? "it is" : "they are"} marked <strong className="font-semibold">out of date</strong>.
        Nothing is re-run by itself: each screen then asks whether to bring it up to date or keep it as it is.
      </p>
    </Modal>
  );
}

/** Analysing while a topic has fewer than 3 papers: say which, why, and the ways to fix it. */
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
          <Button onClick={onCancel}>Go back and choose papers</Button>
          <Button onClick={onEditSearches}>Edit the search plan</Button>
          <Button variant="primary" onClick={onConfirm}>Analyse anyway</Button>
        </>
      }
    >
      <ul className="mb-3 list-disc space-y-1 pl-5">
        {topics.map((t) => (
          <li key={t.name}>
            <strong className="font-semibold">{t.name}</strong>: {t.selected === 0 ? "no papers" : `${t.selected} paper${t.selected === 1 ? "" : "s"}`} chosen
            {t.spare > 0 ? `; ${t.spare} more match${t.spare === 1 ? "es" : ""} the topic` : t.matching === 0 ? "; no papers match the topic" : `; only ${t.matching} match${t.matching === 1 ? "es" : ""} the topic`}
          </li>
        ))}
      </ul>
      <p>
        Only the chosen papers are analysed, so {topics.length === 1 ? "this topic" : "these topics"} will have little or no evidence later.
        {canPick && " You can tick more matching papers first."}
        {fewMatch.length > 0 && ` Few of the papers found match ${fewMatch.length === 1 ? `“${fewMatch[0].name}”` : "some topics"}: to find more, change the search plan, then bring the later screens up to date.`}
      </p>
    </Modal>
  );
}

/** Summarising while quotes are undecided: the evidence summary leaves them out. */
export function ConfirmLeaveOutDialog({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const n = `${count} quote${count === 1 ? "" : "s"}`;
  return (
    <Modal
      open
      onClose={onCancel}
      title={`${n} not decided yet`}
      footer={
        <>
          <Button onClick={onCancel}>Go back and decide</Button>
          <Button variant="primary" onClick={onConfirm}>Summarise without {count === 1 ? "it" : "them"}</Button>
        </>
      }
    >
      <p>
        {n} you have not decided will be left out of the evidence summary. The check could not find {count === 1 ? "it" : "them"} word for word in the article. Accept a quote
        if the article does say it, and it will be used.
      </p>
    </Modal>
  );
}
