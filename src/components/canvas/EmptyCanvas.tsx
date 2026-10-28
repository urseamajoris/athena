"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { api } from "../api";
import { Spinner } from "../ui";
import { AppMenu } from "../AppMenu";
import { canvasStore } from "../session/SessionContext";

/** A new session: an empty canvas with one prompt. Enter creates the Idea node. */
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
        <Link href="/sessions" className="inline-flex h-11 items-center gap-2 rounded-sm px-1" aria-label="Athena: all sessions">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-line-strong bg-bg-2 text-12 font-semibold">A</span>
        </Link>
        <AppMenu />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-24">
        <form onSubmit={create} className="w-full max-w-xl">
          <label htmlFor="idea" className="block text-center text-28 font-semibold">What do you want to understand?</label>
          <textarea
            id="idea"
            autoFocus
            rows={2}
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
            placeholder="e.g. What is the knowledge gap in implementing telemedicine in Southeast Asia?"
            className="input mt-6 resize-none border-line-control bg-bg-1 px-4 py-3 text-16 leading-6 [caret-color:var(--fg-0)]"
          />
          <p id="idea-hint" className="mt-2 text-center text-12 text-fg-2">Enter creates your idea · Shift+Enter adds a line</p>
          <p id="idea-error" role="alert" className="mt-2 min-h-4 text-center text-12 text-err">{err}</p>
          <div aria-hidden className="mx-auto mt-6 flex h-[124px] w-[248px] flex-col rounded-md border border-dashed border-line-control bg-bg-1 p-3 opacity-80">
            <span className="flex items-center gap-2 text-12 text-fg-2"><Lightbulb className="h-4 w-4" strokeWidth={1.5} /> Idea</span>
            <span className="mt-2 line-clamp-3 text-16 text-fg-1">{idea.trim() || "Your idea becomes the first node"}</span>
          </div>
          <div className="mt-6 flex justify-center">
            <button className="btn-primary min-h-11 px-6 text-16" aria-disabled={tooShort || busy || undefined}>
              {busy && <Spinner />} Create idea
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
