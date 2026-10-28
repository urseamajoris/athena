"use client";
import { useEffect, useRef, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, Spinner, cx } from "../ui";
import { SectionTitle, useWizard } from "../wizard/Wizard";
import { ConceptMap } from "./ConceptMap";

interface Topic { id: string; name: string; synonyms: string[]; controlledTerms: string[]; rationale: string; origin: string }
interface ScopingData {
  messages: { id: string; role: string; text: string }[];
  asked: number;
  maxQuestions: number;
  coverage: Record<string, string | null> | null;
  draftTopics: string[];
  done: boolean;
  awaitingAnswer: boolean;
  topics: Topic[];
  conceptMap: { nodes: { id: string; label: string; kind: string }[]; edges: { from: string; to: string; label: string }[] } | null;
  summary: Record<string, string> | null;
}

const COVERAGE_LABEL: Record<string, string> = { population: "Population", setting: "Setting", phenomenon: "Intervention / phenomenon", outcome: "Outcome", timeframe: "Time frame", studyTypes: "Study types" };

export function ScopingStage() {
  const { projectId, states, confirmEdit, refresh } = useWizard();
  const path = projectPath(projectId, "scoping");
  const { data, error, isLoading, mutate } = useApi<ScopingData>(path);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const started = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const upstreamOk = states["1"] === "approved";

  async function call(kind: string, p: string, body: unknown = {}) {
    setBusy(kind);
    setErr(null);
    try {
      const d = await api<ScopingData>(projectPath(projectId, p), { body });
      await mutate(d, { revalidate: false });
      await refresh();
      return d;
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }

  // First question is asked automatically once the idea is approved.
  useEffect(() => {
    if (data && upstreamOk && data.messages.length === 0 && !started.current) {
      started.current = true;
      call("start", "scoping/start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, upstreamOk]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [data?.messages.length]);

  if (!upstreamOk && !data?.messages.length) return <EmptyState title="Approve your idea first">Scoping starts once step 1 is approved.</EmptyState>;
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    const text = answer;
    setAnswer("");
    const d = await call("answer", "scoping/answer", { text });
    if (!d) setAnswer(text);
  }

  async function genTopics() {
    if (data!.topics.length && !(await confirmEdit(2))) return;
    await call("topics", "scoping/topics");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Chat */}
      <section aria-label="Scoping conversation" className="card flex min-h-[420px] flex-col self-start lg:sticky lg:top-16 lg:max-h-[calc(100vh-10rem)]">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
          <p className="text-sm font-semibold text-gray-700">Scoping chat</p>
          <span className="text-xs text-gray-500">Question {Math.min(data.asked, data.maxQuestions)} of at most {data.maxQuestions}</span>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
          {data.messages.map((m) => (
            <div key={m.id} className={cx("max-w-[90%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed", m.role === "assistant" ? "bg-gray-100 text-gray-900" : "ml-auto bg-teal-700 text-white")}>
              {m.text}
            </div>
          ))}
          {busy === "start" || busy === "answer" ? <div className="flex items-center gap-2 text-sm text-gray-500"><Spinner /> Thinking about the next question…</div> : null}
          <div ref={chatEnd} />
        </div>
        {err ? <div className="px-4 pb-2"><ErrorState error={err} title="The AI step failed" onRetry={() => (data.messages.length ? undefined : call("start", "scoping/start"))} /></div> : null}
        {!data.done ? (
          <form onSubmit={send} className="border-t border-gray-100 p-3">
            <label htmlFor="answer" className="sr-only">Your answer</label>
            <textarea
              id="answer"
              className="input min-h-16"
              placeholder={data.awaitingAnswer ? "Type your answer… (Enter to send, Shift+Enter for a new line)" : "Waiting for a question…"}
              value={answer}
              disabled={!data.awaitingAnswer || !!busy}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
            />
            <div className="mt-2 flex justify-between gap-2">
              <button type="button" className="btn-ghost text-xs" onClick={() => call("skip", "scoping/skip")} disabled={!!busy || !data.messages.length}>Skip remaining questions</button>
              <button className="btn-primary" disabled={!data.awaitingAnswer || !answer.trim() || !!busy}>{busy === "answer" && <Spinner />} Send</button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 p-3">
            <button className="btn-ghost text-xs" onClick={async () => { if (await confirmEdit(2)) call("restart", "scoping/restart"); }} disabled={!!busy}>Restart conversation</button>
            <button className="btn-primary" onClick={genTopics} disabled={!!busy}>
              {busy === "topics" && <Spinner />} {data.topics.length ? "Regenerate topics" : "Build my search topics →"}
            </button>
          </div>
        )}
      </section>

      {/* Live topic list */}
      <section aria-label="Topics" className="space-y-4">
        {data.coverage && (
          <div className="card p-4">
            <SectionTitle>What we know so far</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
              {Object.entries(COVERAGE_LABEL).map(([k, label]) => (
                <div key={k}>
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className={data.coverage![k] ? "text-gray-900" : "italic text-gray-400"}>{data.coverage![k] ?? "not yet covered"}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {data.topics.length === 0 ? (
          <div className="card p-4">
            <SectionTitle>Draft topics (building as you answer)</SectionTitle>
            {data.draftTopics.length ? (
              <ul className="flex flex-wrap gap-2">{data.draftTopics.map((t) => <li key={t}><Badge tone="teal">{t}</Badge></li>)}</ul>
            ) : (
              <p className="text-sm text-gray-500">Topics will appear here as the conversation goes.</p>
            )}
            {busy === "topics" && <p className="mt-3 flex items-center gap-2 text-sm text-gray-600"><Spinner /> Building topics, synonyms and MeSH terms…</p>}
          </div>
        ) : (
          <TopicEditor topics={data.topics} onChange={(d) => mutate(d, { revalidate: false })} />
        )}
        {data.conceptMap && (
          <div className="card p-4">
            <SectionTitle>Concept map</SectionTitle>
            <ConceptMap map={data.conceptMap} />
          </div>
        )}
      </section>
    </div>
  );
}

function splitList(s: string) {
  return s.split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
}

function TopicEditor({ topics, onChange }: { topics: Topic[]; onChange: (d: ScopingData) => void }) {
  const { projectId, confirmEdit, refresh } = useWizard();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState("");
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function mutateTopics(fn: () => Promise<ScopingData>) {
    if (!(await confirmEdit(2))) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await fn());
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <SectionTitle right={<span className="text-xs text-gray-500">{topics.length} topic{topics.length === 1 ? "" : "s"} {topics.length < 4 || topics.length > 8 ? "· aim for 4–8" : ""}</span>}>Search topics</SectionTitle>
      <p className="mb-3 text-xs text-gray-500">Rename, edit synonyms and MeSH terms, delete, add, or tick two or more topics to merge them. Changes save when you leave a field.</p>
      <ul className="space-y-3">
        {topics.map((t) => (
          <li key={t.id} className={cx("rounded-lg border p-3", sel.has(t.id) ? "border-teal-500 bg-teal-50/40" : "border-gray-200")}>
            <div className="flex items-start gap-2">
              <input type="checkbox" className="mt-2.5 h-4 w-4 accent-teal-700" aria-label={`Select ${t.name} for merging`} checked={sel.has(t.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.id); else n.delete(t.id); setSel(n); }} />
              <div className="min-w-0 flex-1 space-y-2">
                <input className="input font-medium" aria-label="Topic name" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && mutateTopics(() => api(projectPath(projectId, `topics/${t.id}`), { method: "PATCH", body: { name: e.target.value } }))} />
                <p className="text-xs text-gray-500">{t.rationale} {t.origin !== "ai" && <Badge>{t.origin === "user" ? "added by you" : "merged"}</Badge>}</p>
                <label className="block text-xs text-gray-600">Synonyms (comma-separated)
                  <input className="input mt-0.5 text-xs" defaultValue={t.synonyms.join(", ")} onBlur={(e) => e.target.value !== t.synonyms.join(", ") && mutateTopics(() => api(projectPath(projectId, `topics/${t.id}`), { method: "PATCH", body: { synonyms: splitList(e.target.value) } }))} />
                </label>
                <label className="block text-xs text-gray-600">Controlled vocabulary (MeSH)
                  <input className="input mt-0.5 text-xs" defaultValue={t.controlledTerms.join(", ")} placeholder="none" onBlur={(e) => e.target.value !== t.controlledTerms.join(", ") && mutateTopics(() => api(projectPath(projectId, `topics/${t.id}`), { method: "PATCH", body: { controlledTerms: splitList(e.target.value) } }))} />
                </label>
              </div>
              <button className="btn-ghost text-xs text-rose-700" aria-label={`Delete topic ${t.name}`} onClick={() => mutateTopics(() => api(projectPath(projectId, `topics/${t.id}`), { method: "DELETE" }))} disabled={busy}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {sel.size >= 2 && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-teal-50 p-3">
          <label className="min-w-48 flex-1 text-xs text-gray-700">Name for the merged topic
            <input className="input mt-0.5" value={mergeName} onChange={(e) => setMergeName(e.target.value)} placeholder={topics.filter((t) => sel.has(t.id)).map((t) => t.name).join(" / ")} />
          </label>
          <button className="btn-primary" disabled={busy} onClick={() => mutateTopics(async () => { const d = await api<ScopingData>(projectPath(projectId, "topics/merge"), { body: { ids: [...sel], name: mergeName || topics.filter((t) => sel.has(t.id)).map((t) => t.name).join(" / ") } }); setSel(new Set()); setMergeName(""); return d; })}>
            Merge {sel.size} topics
          </button>
        </div>
      )}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; mutateTopics(async () => { const r = await api<{ state: ScopingData }>(projectPath(projectId, "topics"), { body: { name: newName } }); setNewName(""); return r.state; }); }}>
        <label htmlFor="new-topic" className="sr-only">New topic name</label>
        <input id="new-topic" className="input" placeholder="Add a topic…" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn-secondary" disabled={busy || !newName.trim()}>Add</button>
      </form>
      {err ? <div className="mt-3"><ErrorState error={err} /></div> : null}
    </div>
  );
}
