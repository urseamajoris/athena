"use client";
import { LogoMark } from "../Logo";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { api } from "../api";
import { Spinner } from "../ui";
import { AppMenu } from "../AppMenu";
import { canvasStore } from "../session/SessionContext";

const EXAMPLES = [
  "Does sleep affect exam grades in university students?",
  "What helps nurses stay in rural hospitals?",
  "How does telemedicine work for older patients in Southeast Asia?",
];

/** A new review: one prompt. Enter creates the review and its first step, the idea. */
export function EmptyCanvas() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tooShort = idea.trim().length < 10;

  async function create(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (tooShort) {
      setErr("Write at least a sentence (10 characters or more).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { id } = await api<{ id: string }>("/api/projects", { body: { idea } });
      canvasStore.getState().setIntro("idea");
      router.replace(`/s/${id}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-bg-0 [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:24px_24px]">
      <header className="flex h-12 items-center justify-between px-2 md:px-4">
        <Link href="/sessions" className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-sm px-1 font-semibold" aria-label="Athena: my projects">
          <LogoMark /> <span>My projects</span>
        </Link>
        <AppMenu />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-24">
        <form onSubmit={create} className="w-full max-w-xl">
          <p className="text-center text-12 font-medium text-fg-1">Step 1 of 9 · Your idea</p>
          <label htmlFor="idea" className="mt-1 block text-center text-28 font-semibold">Describe your research idea</label>
          <p className="mt-2 text-center text-fg-1">A sentence or two, the way you would say it to a supervisor. It does not need to be a polished question: Athena helps you sharpen it next.</p>
          <textarea
            id="idea"
            autoFocus
            rows={4}
            value={idea}
            onChange={(e) => {
              setIdea(e.target.value);
              if (err) setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                create();
              }
            }}
            aria-describedby="idea-hint idea-error"
            placeholder="e.g. Does sleep affect exam grades?"
            className="input mt-4 min-h-28 resize-y border-line-control bg-bg-1 px-4 py-3 text-16 leading-6 [caret-color:var(--fg-0)]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1" aria-label="Examples">
            <span className="text-12 text-fg-2">Try:</span>
            {EXAMPLES.map((x) => <button key={x} type="button" className="rounded-full border border-line px-2 py-1 text-12 text-fg-1 hover:border-line-strong hover:text-fg-0" onClick={() => { setIdea(x); setErr(null); }}>{x}</button>)}
          </div>
          <p id="idea-error" role="alert" className="mt-2 min-h-4 text-center text-12 text-err">{err}</p>
          <div className="mt-4 flex flex-col items-center gap-2">
            <button className="btn-primary min-h-11 w-full px-6 sm:w-auto" data-await-input aria-disabled={tooShort || busy || undefined}>
              {busy && <Spinner />} Start my review
            </button>
            <p id="idea-hint" className="text-12 text-fg-2">{tooShort ? "Write at least a sentence to start." : "Enter starts it · Shift+Enter adds a line"}</p>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-12 text-fg-2"><Lightbulb className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Next: up to five short questions to sharpen your idea into search topics.</p>
        </form>
      </main>
    </div>
  );
}
