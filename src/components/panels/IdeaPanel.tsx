"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, projectPath, useApi } from "../api";
import { Badge, ErrorState, Loading, Spinner, aiStopKind, cx, isOutOfCredits } from "../ui";
import { Disclosure } from "../disclosure";
import { useSession } from "../session/SessionContext";
import { noCredits } from "../credits";
import { PanelFooter, SectionTitle } from "./common";
import { ConceptMap } from "./ConceptMap";
import dynamic from "next/dynamic";
import { CheckCircle2 } from "lucide-react";
import { focusWithRing, revealAboveActionBar } from "../focus";
import { TopicUndo } from "./topic-undo";

const TopicConstellation = dynamic(() => import("../viz/TopicConstellation").then((m) => m.TopicConstellation), { ssr: false, loading: () => <Loading label="Drawing your topics…" /> });

interface Topic { id: string; name: string; synonyms: string[]; controlledTerms: string[]; rationale: string; origin: string; approved: boolean }
export interface ScopingData {
  messages: { id: string; role: string; text: string }[];
  asked: number;
  maxQuestions: number;
  coverage: Record<string, string | null> | null;
  draftTopics?: string[];
  done: boolean;
  awaitingAnswer: boolean;
  topics?: Topic[];
  conceptMap?: { nodes: { id: string; label: string; kind: string }[]; edges: { from: string; to: string; label: string }[] } | null;
  summary?: Record<string, string> | null;
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

/**
 * The short conversation that sharpens the idea (up to five questions), with what has been learned so far.
 * `chatOnly` leaves out the topic list and the idea editor, for the Question screen.
 */
export function IdeaPanel({ chatOnly = false }: { chatOnly?: boolean }) {
  const { projectId, project, states, refresh, confirmEdit, ai, credits } = useSession();
  // No request is sent while it is known that AI cannot run: the step frame's banner already says why.
  const canAi = ai.enabled && !ai.keyMissing && !ai.budgetReached && !noCredits(credits);
  const { data: raw, error, isLoading, mutate } = useApi<ScopingData>(projectPath(projectId, "scoping"));
  // The server's view may or may not carry topics (they belong to the search plan): none is the same as an empty list.
  const data = useMemo(() => (raw ? { ...raw, topics: raw.topics ?? [], draftTopics: raw.draftTopics ?? [], conceptMap: raw.conceptMap ?? null } : raw), [raw]);
  const [idea, setIdea] = useState(project.idea);
  const [answer, setAnswer] = useState("");
  // The answer just sent, shown as the user's message until the server returns the conversation with it.
  const [sent, setSent] = useState<string | null>(null);
  // What a filled-but-waiting button says when clicked (cleared as soon as the user types).
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => setHint(null), [answer, idea]);
  const [local, setLocal] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const started = useRef(false);
  const chatList = useRef<HTMLDivElement>(null);
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
    if (data && ideaApproved && canAi && data.messages.length === 0 && !started.current) {
      started.current = true;
      call("start", "scoping/start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ideaApproved, canAi]);
  // A new question puts the cursor in the answer box, once the request that brought it has finished (`local`).
  // The conversation scrolls inside its own box; the panel scrolls to the answer box (not to the last message,
  // which left the box behind the pinned footer on short screens).
  useEffect(() => {
    const list = chatList.current;
    if (list) list.scrollTop = list.scrollHeight;
    if (data?.awaitingAnswer && !local) {
      answerRef.current?.focus({ preventScroll: true });
      revealAboveActionBar(answerRef.current);
    }
  }, [data?.messages.length, data?.awaitingAnswer, local]);

  // When the questions end (the last answer, or "Skip the rest") the answer box goes away. Say so where the
  // cursor was, and keep anything typed after the last answer was sent: it is shown, never silently dropped.
  const chatOpenNow = !!data && ideaApproved && !data.done && !data.topics.length;
  const wasOpen = useRef(chatOpenNow);
  const [ended, setEnded] = useState<{ unsent: string; focus: boolean } | null>(null);
  const endedRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (chatOpenNow) setEnded(null);
    else if (wasOpen.current) {
      const a = document.activeElement;
      // Focus was in the box or on a button that went away (or already sent to the panel heading by FocusPanel).
      setEnded({ unsent: answer.trim(), focus: !a || a === document.body || !a.isConnected || a.matches("h1") });
    }
    wasOpen.current = chatOpenNow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpenNow]);
  // Before the panel's own focus recovery, which would put the cursor on the heading, where typing goes nowhere.
  useLayoutEffect(() => {
    if (ended?.focus) focusWithRing(endedRef.current);
  }, [ended]);

  // Before step 1 is approved the idea saves itself shortly after typing stops, so every "Sharpen my idea" button
  // (the panel's and the canvas card's) uses what is on screen.
  useEffect(() => {
    // Above the early returns (hooks always run); only once the data has loaded, when saveIdea can run.
    if (!data || ideaApproved || idea.trim() === project.idea.trim() || idea.trim().length < 10) return;
    const t = setTimeout(() => void saveIdea(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea, ideaApproved]);
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
    // Typing while the next question is on its way is kept in the box; it is sent once that question is there.
    if (local) return setHint("Wait for the next question to appear. What you typed stays in the box.");
    const text = answer;
    setAnswer("");
    setSent(text);
    const d = await call("answer", "scoping/answer", { text });
    setSent(null);
    if (!d) setAnswer((typed) => (typed.trim() ? `${text} ${typed.trim()}` : text)); // keep what was typed while sending
  }

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
      {!ideaApproved && !chatOnly ? (
        <div>
          <label htmlFor="idea-edit" className="label">Your research idea</label>
          <textarea id="idea-edit" className="input min-h-36 leading-relaxed" value={idea} placeholder="e.g. What is the knowledge gap in implementing telemedicine in Southeast Asia?" onChange={(e) => setIdea(e.target.value)} />
          <p className="mt-2 text-12 text-fg-2">{!dirty ? "Saved." : idea.trim().length < 10 ? "Write at least a sentence (10 characters) and it saves itself." : "Saving…"} It does not need to be a polished question yet.</p>
        </div>
      ) : null}

      {ideaApproved && chatOpen && data.messages.length === 0 && !local ? (
        // Nothing asked yet: say why, instead of an empty conversation with a box that cannot be typed in.
        <p className="flex items-center gap-2 text-fg-1">
          {canAi ? <><Spinner /> Preparing the first question…</> : "The questions appear here when AI is available. You can write your own research question below without them."}
        </p>
      ) : ideaApproved && (chatOpen ? (
        <section aria-label="Scoping conversation" className="rounded-md border border-line">
          <div ref={chatList} className="max-h-80 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {data.messages.map((m) => (
              <div key={m.id} data-role={m.role} className={cx("max-w-[90%] rounded-md px-3 py-2 leading-relaxed", m.role === "assistant" ? "bg-bg-2 text-fg-0" : "ml-auto bg-bg-3 text-fg-0")}>
                {m.text}
              </div>
            ))}
            {sent && local === "answer" && <div data-role="user" className="ml-auto max-w-[90%] rounded-md bg-bg-3 px-3 py-2 leading-relaxed text-fg-0">{sent}</div>}
            {local === "start" || local === "answer" ? <p className="flex items-center gap-2 text-fg-2"><Spinner /> Thinking about the next question…</p> : null}
          </div>
          <form id="scoping-answer-form" onSubmit={send} className="border-t border-line p-3">
            <label htmlFor="answer" className="sr-only">Your answer</label>
            <textarea
              id="answer"
              ref={answerRef}
              className="input min-h-16"
              placeholder={data.awaitingAnswer ? "Type your answer in your own words (Enter sends)" : "Waiting for the next question…"}
              value={answer}
              // Not disabled while an answer is being sent: a disabled box would drop what is typed meanwhile.
              disabled={!data.awaitingAnswer || (!!local && local !== "answer")}
              aria-busy={local === "answer" || undefined}
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

      {ended && !chatOpen && (!data.topics.length || ended.unsent || ended.focus) && (
        <div ref={endedRef} tabIndex={-1} role="status" className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-fg-0">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={1.5} aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p><strong className="font-semibold">The questions are done.</strong></p>
            {ended.unsent && (
              <>
                <p className="text-fg-1">You typed this after the last question, so it was not sent. Add it to a topic or to the idea if you need it:</p>
                <blockquote className="whitespace-pre-wrap border-l-2 border-line-control pl-2 text-fg-1">{ended.unsent}</blockquote>
              </>
            )}
          </div>
        </div>
      )}

      {!chatOnly && data.topics.length > 0 && (
        <section aria-label="Topics">
          <SectionTitle right={<span className="text-12 text-fg-2">{data.topics.length} topic{data.topics.length === 1 ? "" : "s"}{data.topics.length < 4 || data.topics.length > 8 ? " · aim for 4–8" : ""}</span>}>Topics</SectionTitle>
          <ul className="space-y-1">
            {data.topics.map((t) => (
              <li key={t.id} className="flex min-h-11 flex-wrap items-center gap-2 px-2 py-2">
                <span className="min-w-0 flex-1">{t.name}</span>
                {t.origin !== "ai" ? <Badge>{t.origin === "user" ? "added by you" : "merged"}</Badge> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!chatOnly && <TopicUndo />}

      {ideaApproved && (data.messages.length > 0 || !!local) && (chatOnly || !data.topics.length) && (
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

      {!chatOnly && data.topics.length === 0 && data.draftTopics.length > 0 && (
        <section aria-label="Draft topics">
          <SectionTitle>Search topics taking shape</SectionTitle>
          <ul className="flex flex-wrap gap-2">{data.draftTopics.map((t) => <li key={t}><Badge>{t}</Badge></li>)}</ul>
        </section>
      )}

      {!chatOnly && data.topics.length > 0 && (
        <Disclosure title="What we know so far" meta={`${answered} of ${Object.keys(COVERAGE_LABEL).length} answered`}>
          {knownList()}
        </Disclosure>
      )}
      {!chatOnly && data.topics.length > 0 && <ManageTopics topics={data.topics} onChange={(d) => mutate(d, { revalidate: false })} />}
      {!chatOnly && data.topics.length > 0 && (
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
      {ideaApproved && !chatOnly && (
        <Disclosure title="Edit the idea">
          <label htmlFor="idea-reedit" className="label">Research idea</label>
          <textarea id="idea-reedit" className="input min-h-28 leading-relaxed" value={idea} onChange={(e) => setIdea(e.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            {dirty && <button className="btn-ghost" onClick={() => setIdea(project.idea)}>Undo</button>}
            <button className="btn-secondary" disabled={!dirty} onClick={saveIdea}>Save the idea</button>
          </div>
        </Disclosure>
      )}
      {!ideaApproved && !chatOnly && (
        <Disclosure title="How this works">
          <ul className="list-disc space-y-1 pl-4 text-fg-1">
            <li>Every AI suggestion appears as a draft you can edit before anything else runs.</li>
            <li>Every paper comes from a real PubMed or OpenAlex record with its identifier; the AI never adds references from memory.</li>
            <li>Every extracted finding carries a quote that is checked against the text that was actually retrieved.</li>
          </ul>
        </Disclosure>
      )}

      {/* AI that cannot run (no key, switched off, no credits) is said once, by the step frame's banner. */}
      {err && !aiStopKind(err) && !isOutOfCredits(err) ? <ErrorState error={err} title="That did not work" onRetry={data.messages.length ? undefined : () => call("start", "scoping/start")} /> : null}

      {chatOpen && data.messages.length > 0 && (
        <PanelFooter note={hint ? <span role="alert" className="font-medium text-fg-0">{hint}</span> : "Up to five short questions. “Skip the rest” ends them now."}>
          <button type="button" className="btn-secondary" disabled={!!local} onClick={() => call("skip", "scoping/skip")}>Skip the rest</button>
          <button type="submit" form="scoping-answer-form" className="btn-primary" data-await-input aria-disabled={!answer.trim() || !!local || undefined} onClick={(e) => { if (!answer.trim() || local) e.preventDefault(); if (!answer.trim() && !local) setHint(data.awaitingAnswer ? "Type an answer first, or use “Skip the rest”." : "Wait for the next question to appear."); }}>
            {local === "answer" && <Spinner />} Send answer
          </button>
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

/** Edit one search topic: its name, synonyms and MeSH terms. */
export function TopicPanel({ topicId }: { topicId: string }) {
  const { projectId, confirmEdit, refresh } = useSession();
  const { data, mutate } = useApi<{ topics: Topic[] }>(projectPath(projectId, "search"));
  const [err, setErr] = useState<unknown>(null);
  const t = data?.topics.find((x) => x.id === topicId);
  if (!data) return <Loading />;
  if (!t) return <p className="text-fg-2">This topic no longer exists.</p>;
  async function patch(body: Record<string, unknown>) {
    if (!(await confirmEdit(3))) return;
    setErr(null);
    try {
      mutate(await api<{ topics: Topic[] }>(projectPath(projectId, `topics/${topicId}`), { method: "PATCH", body }), { revalidate: false });
      await refresh();
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <div className="space-y-4">
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
    </div>
  );
}
