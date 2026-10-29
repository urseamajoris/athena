"use client";
import { useEffect, useRef, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, ErrorState, Loading, Spinner, cx } from "../ui";
import { Disclosure } from "../disclosure";
import { canvasStore, cmdKey, useSession } from "../session/SessionContext";
import { ActionButton, PanelFooter, SectionTitle } from "./common";
import { ConceptMap } from "./ConceptMap";
import { WhatHappens } from "../guide/WhatHappens";
import dynamic from "next/dynamic";

const TopicConstellation = dynamic(() => import("../viz/TopicConstellation").then((m) => m.TopicConstellation), { ssr: false, loading: () => <Loading label="Drawing your topics…" /> });
import { stageAction } from "@/lib/canvas/actions";
import { frontierStage, isGhostTopic } from "@/lib/canvas/graph";

interface Topic { id: string; name: string; synonyms: string[]; controlledTerms: string[]; rationale: string; origin: string; approved: boolean }
export interface ScopingData {
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

/** The scope, in plain words (the PICO-style fields: population, setting, phenomenon, outcome…). */
const COVERAGE_LABEL: Record<string, [string, string]> = {
  population: ["Who", "the people or group you want to study"],
  setting: ["Where", "the place or setting"],
  phenomenon: ["What is studied", "the exposure, intervention or topic"],
  outcome: ["What you want to know", "the result or outcome that matters"],
  timeframe: ["Which years", "how recent the papers should be"],
  studyTypes: ["Which kinds of studies", "e.g. trials, surveys, interviews, reviews"],
};

/** Idea node: the idea itself, then the scoping chat whose answers fill the scope (PICO-style) fields. */
export function IdeaPanel() {
  const { projectId, project, states, refresh, confirmEdit, run, busy, input, summary } = useSession();
  const { data, error, isLoading, mutate } = useApi<ScopingData>(projectPath(projectId, "scoping"));
  const [idea, setIdea] = useState(project.idea);
  const [answer, setAnswer] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const started = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const s1 = states["1"];
  const ideaApproved = s1 === "approved";
  useEffect(() => setIdea(project.idea), [project.idea]);

  async function call(kind: string, p: string, body: unknown = {}) {
    setLocal(kind);
    setErr(null);
    try {
      const d = await api<ScopingData>(projectPath(projectId, p), { body });
      await mutate(d, { revalidate: false });
      await refresh();
      return d;
    } catch (e) {
      setErr(e);
    } finally {
      setLocal(null);
    }
  }

  // The first scoping question is asked as soon as the idea is approved.
  useEffect(() => {
    if (data && ideaApproved && data.messages.length === 0 && !started.current) {
      started.current = true;
      call("start", "scoping/start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ideaApproved]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
    if (data?.awaitingAnswer) answerRef.current?.focus({ preventScroll: true });
  }, [data?.messages.length, data?.awaitingAnswer]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return null;

  const dirty = idea.trim() !== project.idea.trim();
  async function saveIdea() {
    if (!dirty) return true;
    if (!(await confirmEdit(1))) return false;
    try {
      await api(projectPath(projectId, "idea"), { method: "PATCH", body: { idea } });
      await refresh();
      return true;
    } catch (e) {
      setErr(e);
      return false;
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    const text = answer;
    setAnswer("");
    const d = await call("answer", "scoping/answer", { text });
    if (!d) setAnswer(text);
  }

  const isFrontier = frontierStage(states) === 1 || frontierStage(states) === 2;
  const action = isFrontier ? stageAction(frontierStage(states), input) : null;
  const ghosts = (summary?.topics ?? []).filter((t) => isGhostTopic(t, states, input.client.acceptedTopics));
  const chatOpen = ideaApproved && !data.done && !data.topics.length;
  const answered = Object.keys(COVERAGE_LABEL).filter((k) => data.coverage?.[k]).length;
  const knownList = (onlyAnswered = false) => (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {Object.entries(COVERAGE_LABEL).filter(([k]) => !onlyAnswered || data.coverage?.[k]).map(([k, [label, hint]]) => (
        <div key={k}>
          <dt className="text-12 text-fg-1"><span className="font-medium">{label}</span> <span className="text-fg-2">· {hint}</span></dt>
          <dd className={data.coverage?.[k] ? "text-fg-0" : "text-fg-2"}>{data.coverage?.[k]?.replace(/[\s;,.]+$/, "") || "not answered yet"}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="space-y-4">
      {!ideaApproved ? (
        <div>
          <label htmlFor="idea-edit" className="label">Your research idea</label>
          <textarea id="idea-edit" className="input min-h-36 leading-relaxed" value={idea} placeholder="e.g. What is the knowledge gap in implementing telemedicine in Southeast Asia?" onChange={(e) => setIdea(e.target.value)} />
          <p className="mt-2 text-12 text-fg-2">Explain it the way you would to a supervisor. It does not need to be a polished question yet.</p>
        </div>
      ) : null}

      {!ideaApproved && <WhatHappens stage={1} />}
      {ideaApproved && <WhatHappens stage={2} />}

      {ideaApproved && (chatOpen ? (
        <section aria-label="Scoping conversation" className="rounded-md border border-line">
          <div className="max-h-80 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {data.messages.map((m) => (
              <div key={m.id} data-role={m.role} className={cx("max-w-[90%] rounded-md px-3 py-2 leading-relaxed", m.role === "assistant" ? "bg-bg-2 text-fg-0" : "ml-auto bg-bg-3 text-fg-0")}>
                {m.text}
              </div>
            ))}
            {local === "start" || local === "answer" ? <p className="flex items-center gap-2 text-fg-2"><Spinner /> Thinking about the next question…</p> : null}
            <div ref={chatEnd} />
          </div>
          <form id="scoping-answer-form" onSubmit={send} className="border-t border-line p-3">
            <label htmlFor="answer" className="sr-only">Your answer</label>
            <textarea
              id="answer"
              ref={answerRef}
              className="input min-h-16"
              placeholder={data.awaitingAnswer ? "Type your answer in your own words (Enter sends)" : "Waiting for the next question…"}
              value={answer}
              disabled={!data.awaitingAnswer || !!local}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
            />
          </form>
        </section>
      ) : (
        data.messages.length > 0 && (
          <Disclosure title="Scoping conversation" meta={`${data.asked} questions`}>
            <div className="space-y-2">
              {data.messages.map((m) => (
                <p key={m.id} data-role={m.role} className={m.role === "assistant" ? "text-fg-1" : "text-fg-0"}><span className="text-12 text-fg-2">{m.role === "assistant" ? "Athena" : "You"}: </span>{m.text}</p>
              ))}
            </div>
          </Disclosure>
        )
      ))}

      {data.topics.length > 0 && (
        <section aria-label="Topics">
          <SectionTitle right={<span className="text-12 text-fg-2">{data.topics.length} topic{data.topics.length === 1 ? "" : "s"}{data.topics.length < 4 || data.topics.length > 8 ? " · aim for 4–8" : ""}</span>}>Topics</SectionTitle>
          <ul className="space-y-1">
            {data.topics.map((t) => {
              const ghost = !!summary && isGhostTopic({ ...t, synonyms: 0, controlledTerms: 0 }, states, input.client.acceptedTopics);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-1 rounded-sm hover:bg-bg-2">
                  <button className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left" onClick={() => canvasStore.getState().openPanel(`topic:${t.id}`)} title="Open to edit its name and keywords">
                    <span className="min-w-0 flex-1">{t.name}</span>
                    {ghost ? <Badge tone="warn">suggested</Badge> : t.origin !== "ai" ? <Badge>{t.origin === "user" ? "added by you" : "merged"}</Badge> : null}
                  </button>
                  {ghost && (
                    <span className="flex gap-1 pr-1">
                      <button className="btn-ghost btn-sm" onClick={() => canvasStore.getState().openPanel(`topic:${t.id}`)} aria-label={`Edit the topic ${t.name}`}>Edit</button>
                      <button className="btn-secondary btn-sm" onClick={() => run({ type: "acceptTopic", topicId: t.id })} aria-label={`Keep the topic ${t.name}`}>Keep</button>
                      <button className="btn-ghost btn-sm" onClick={() => run({ type: "dismissTopic", topicId: t.id })} aria-label={`Delete the topic ${t.name}`}>Delete</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {ghosts.length > 0 && <p className="mt-2 text-12 text-fg-2">Suggested topics stay dashed until you keep or delete them. Keep the ones that are part of your question; you can edit any topic afterwards.</p>}
        </section>
      )}

      {ideaApproved && !data.topics.length && (
        <section aria-label="What we know so far">
          <SectionTitle right={<span className="text-12 tabular-nums text-fg-2">{chatOpen ? `question ${Math.max(1, Math.min(data.asked, data.maxQuestions))} of up to ${data.maxQuestions}` : "questions done"}</span>}>What we know so far</SectionTitle>
          {chatOpen ? (
            <>
              {answered > 0 && knownList(true)}
              <p className="mt-1 text-12 text-fg-2">{answered ? `${Object.keys(COVERAGE_LABEL).length - answered} more to cover` : "Filled in as you answer"}: {Object.entries(COVERAGE_LABEL).filter(([k]) => !data.coverage?.[k]).map(([, [label]]) => label.toLowerCase()).join(", ")}.</p>
            </>
          ) : (
            knownList()
          )}
        </section>
      )}

      {data.topics.length === 0 && data.draftTopics.length > 0 && (
        <section aria-label="Draft topics">
          <SectionTitle>Search topics taking shape</SectionTitle>
          <ul className="flex flex-wrap gap-2">{data.draftTopics.map((t) => <li key={t}><Badge>{t}</Badge></li>)}</ul>
        </section>
      )}

      {data.topics.length > 0 && (
        <Disclosure title="What we know so far" meta={`${answered} of ${Object.keys(COVERAGE_LABEL).length} answered`}>
          {knownList()}
        </Disclosure>
      )}
      {data.topics.length > 0 && <ManageTopics topics={data.topics} onChange={(d) => mutate(d, { revalidate: false })} />}
      {data.topics.length > 0 && (
        <Disclosure title="See how your topics connect" meta="map">
          <TopicConstellation idea={project.idea} topics={data.topics} />
          {data.conceptMap && (
            <div className="mt-3">
              <p className="mb-1 text-12 text-fg-2">How the AI linked the main ideas:</p>
              <ConceptMap map={data.conceptMap} />
            </div>
          )}
        </Disclosure>
      )}
      {ideaApproved && (
        <Disclosure title="Edit the idea">
          <label htmlFor="idea-reedit" className="label">Research idea</label>
          <textarea id="idea-reedit" className="input min-h-28 leading-relaxed" value={idea} onChange={(e) => setIdea(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            {dirty && <button className="btn-ghost" onClick={() => setIdea(project.idea)}>Undo</button>}
            <button className="btn-secondary" disabled={!dirty} onClick={saveIdea}>Save the idea</button>
          </div>
        </Disclosure>
      )}
      {!ideaApproved && (
        <Disclosure title="How this works">
          <ul className="list-disc space-y-1 pl-4 text-fg-1">
            <li>Every AI suggestion appears as a draft you can edit before anything else runs.</li>
            <li>Every paper comes from a real PubMed or OpenAlex record with its identifier; the AI never adds references from memory.</li>
            <li>Every extracted finding carries a quote that is checked against the text that was actually retrieved.</li>
          </ul>
        </Disclosure>
      )}

      {err ? <ErrorState error={err} title="That step failed" onRetry={() => (data.messages.length ? undefined : call("start", "scoping/start"))} /> : null}

      {action && (
        <PanelFooter note={chatOpen && data.awaitingAnswer ? "Up to five short questions. “Skip the rest” goes straight to your search topics." : undefined}>
          {!ideaApproved ? (
            <button
              className="btn-primary"
              data-await-input
              data-action="approve"
              aria-disabled={idea.trim().length < 10 || !!busy || undefined}
              onClick={async () => {
                if (idea.trim().length < 10 || busy) return;
                if (await saveIdea()) await run({ type: "approve", stage: 1 });
              }}
            >
              {busy === cmdKey({ type: "approve", stage: 1 }) && <Spinner />} Start scoping
            </button>
          ) : action.cmd.type === "answer" ? (
            <>
            <button type="button" className="btn-ghost" disabled={!!local} onClick={() => call("skip", "scoping/skip")}>Skip the rest</button>
            <button type="submit" form="scoping-answer-form" className="btn-primary" data-await-input aria-disabled={!answer.trim() || !!local || undefined} onClick={(e) => { if (!answer.trim() || local) e.preventDefault(); }}>
              {local === "answer" && <Spinner />} Send answer
            </button>
            </>
          ) : action.cmd.type === "openScoping" ? (
            <p className="flex items-center gap-2 text-fg-2"><Spinner /> Preparing the first question…</p>
          ) : (
            <ActionButton action={action} primary showReason />
          )}
        </PanelFooter>
      )}
    </div>
  );
}

function splitList(s: string) {
  return s.split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
}

/** Merge and add topics (collapsed: the per-topic editing lives in each Topic node). */
function ManageTopics({ topics, onChange }: { topics: Topic[]; onChange: (d: ScopingData) => void }) {
  const { projectId, confirmEdit, refresh } = useSession();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mergeName, setMergeName] = useState("");
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function change(fn: () => Promise<ScopingData>) {
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
    <Disclosure title="Add or merge topics">
      <p className="mb-2 text-12 text-fg-2">Tick two or more topics to merge them into one.</p>
      <ul className="space-y-1">
        {topics.map((t) => (
          <li key={t.id}>
            <label className="flex min-h-11 items-center gap-2 rounded-sm px-2">
              <input type="checkbox" checked={sel.has(t.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(t.id); else n.delete(t.id); setSel(n); }} />
              <span>{t.name}</span>
            </label>
          </li>
        ))}
      </ul>
      {sel.size >= 2 && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-sm bg-bg-2 p-3">
          <label className="min-w-48 flex-1 text-12 text-fg-1">Name for the merged topic
            <input className="input mt-1" value={mergeName} onChange={(e) => setMergeName(e.target.value)} placeholder={topics.filter((t) => sel.has(t.id)).map((t) => t.name).join(" / ")} />
          </label>
          <button className="btn-secondary" disabled={busy} onClick={() => change(async () => { const d = await api<ScopingData>(projectPath(projectId, "topics/merge"), { body: { ids: [...sel], name: mergeName || topics.filter((t) => sel.has(t.id)).map((t) => t.name).join(" / ") } }); setSel(new Set()); setMergeName(""); return d; })}>
            Merge {sel.size} topics
          </button>
        </div>
      )}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; change(async () => { const r = await api<{ state: ScopingData }>(projectPath(projectId, "topics"), { body: { name: newName } }); setNewName(""); return r.state; }); }}>
        <label htmlFor="new-topic" className="sr-only">New topic name</label>
        <input id="new-topic" className="input" placeholder="Add a topic…" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn-secondary" disabled={busy || !newName.trim()}>Add</button>
      </form>
      {err ? <div className="mt-3"><ErrorState error={err} /></div> : null}
    </Disclosure>
  );
}

/** Topic node: edit one topic (name, synonyms, MeSH), or accept / dismiss it while it is a suggestion. */
export function TopicPanel({ topicId }: { topicId: string }) {
  const { projectId, confirmEdit, refresh, states, input, run, graph } = useSession();
  const { data, mutate } = useApi<ScopingData>(projectPath(projectId, "scoping"));
  const [err, setErr] = useState<unknown>(null);
  const t = data?.topics.find((x) => x.id === topicId);
  if (!data) return <Loading />;
  if (!t) return <p className="text-fg-2">This topic no longer exists.</p>;
  const ghost = isGhostTopic({ ...t, synonyms: 0, controlledTerms: 0 }, states, input.client.acceptedTopics);
  async function patch(body: Record<string, unknown>) {
    if (!(await confirmEdit(2))) return;
    setErr(null);
    try {
      mutate(await api<ScopingData>(projectPath(projectId, `topics/${topicId}`), { method: "PATCH", body }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }
  const node = graph.nodes.find((n) => n.id === `topic:${topicId}`);
  const frontier = node && stageAction(frontierStage(states), input);
  const isFrontierNode = node && frontier && (frontierStage(states) === 3 && graph.nodes.find((n) => n.kind === "topic" && !n.ghost)?.id === node.id);
  return (
    <div className="space-y-4">
      {ghost && <p className="rounded-md border border-dashed border-line-control px-3 py-2 text-fg-1">Suggested by the AI from your scoping answers. Accept it to keep it, or dismiss it.</p>}
      <div>
        <label htmlFor={`tn-${t.id}`} className="label">Topic name</label>
        <input id={`tn-${t.id}`} key={`n-${t.name}`} className="input font-medium" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && patch({ name: e.target.value })} />
        <p className="mt-1 text-12 text-fg-2">{t.rationale} {t.origin !== "ai" && <Badge>{t.origin === "user" ? "added by you" : "merged"}</Badge>}</p>
      </div>
      <label className="block text-12 text-fg-1">Synonyms (comma-separated)
        <input className="input mt-1" key={`s-${t.synonyms.join()}`} defaultValue={t.synonyms.join(", ")} onBlur={(e) => e.target.value !== t.synonyms.join(", ") && patch({ synonyms: splitList(e.target.value) })} />
      </label>
      <label className="block text-12 text-fg-1">Controlled vocabulary (MeSH)
        <input className="input mt-1 font-mono" key={`c-${t.controlledTerms.join()}`} defaultValue={t.controlledTerms.join(", ")} placeholder="none" onBlur={(e) => e.target.value !== t.controlledTerms.join(", ") && patch({ controlledTerms: splitList(e.target.value) })} />
      </label>
      <p className="text-12 text-fg-2">Changes save when you leave a field.</p>
      {err ? <ErrorState error={err} /> : null}
      {(ghost || isFrontierNode) && (
        <PanelFooter>
          {ghost ? (
            <>
              <button className="btn-ghost" onClick={() => run({ type: "dismissTopic", topicId })}>Dismiss</button>
              <button className="btn-primary" onClick={() => run({ type: "acceptTopic", topicId })}>Keep this topic</button>
            </>
          ) : (
            frontier && <ActionButton action={frontier} primary showReason />
          )}
        </PanelFooter>
      )}
    </div>
  );
}
