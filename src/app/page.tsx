import Link from "next/link";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { Disclosure } from "@/components/disclosure";
import { TransitionLink } from "@/components/vt";

/** Landing: one sentence, one call to action, one demo. */
export default function Landing() {
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
        <span className="inline-flex items-center gap-2 font-semibold">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-line-strong bg-bg-2">A</span>
          Athena
        </span>
        <Link href="/sessions" className="btn-ghost min-h-11">Your sessions</Link>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        <section className="mx-auto max-w-3xl pt-12 text-center md:pt-20">
          <h1 className="text-28 font-semibold md:text-44">Turn a rough idea into a research question you can defend.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-16 text-fg-1">Athena searches PubMed and OpenAlex, reads the papers with you, and checks every quote against its source, so each step is yours to confirm.</p>
          <div className="mt-8">
            <TransitionLink href="/s/new" className="btn-primary min-h-11 px-6 text-16">Start a review</TransitionLink>
          </div>
        </section>
        <section aria-label="Demo" className="mt-12 md:mt-16">
          <DemoVideo />
        </section>
        <section className="mx-auto mt-8 max-w-2xl">
          <Disclosure title="How it works">
            <ol className="list-decimal space-y-2 pl-6 text-fg-1">
              <li><strong className="font-medium text-fg-0">Scope it.</strong> Type your idea; a few short questions turn it into 4–8 search topics you can edit.</li>
              <li><strong className="font-medium text-fg-0">Find and rank the papers.</strong> Real database queries, deduplicated, summarised and scored with a visible rubric.</li>
              <li><strong className="font-medium text-fg-0">Read, synthesise, decide.</strong> Appraisals with verified quotes become a synthesis and three research questions to choose from.</li>
            </ol>
          </Disclosure>
        </section>
      </main>
    </div>
  );
}
