import { LogoMark } from "@/components/Logo";
import Link from "next/link";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { Disclosure } from "@/components/disclosure";
import { TransitionLink } from "@/components/vt";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/policy";
import { HeroBackdrop } from "@/components/landing/HeroBackdrop";
import { EXPLAINERS } from "@/lib/shared/explainers";

const PHASES = [
  { steps: [1, 2, 3], title: "Shape your question", text: "Write a rough idea. A few short questions turn it into search topics and real database searches you can read and edit.", poster: 2 },
  { steps: [4, 5, 6], title: "Find and pick the papers", text: "Athena searches PubMed and OpenAlex, removes duplicates, drafts a summary of each paper and scores them on a visible rubric.", poster: 6 },
  { steps: [7, 8, 9], title: "Read, weigh, decide", text: "Each chosen paper is appraised with quotes checked word for word, then summarised into what is known, contested and unknown.", poster: 7 },
];

/** Landing: one sentence, one call to action, one demo. */
export default async function Landing() {
  // Signed-in visitors go straight to their projects (a cookie check only: no database call on the landing page).
  if ((await cookies()).get(SESSION_COOKIE)) redirect("/sessions");
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
        <span className="inline-flex items-center gap-2 font-semibold">
          <LogoMark />
          Athena
        </span>
        <Link href="/login" className="btn-ghost min-h-11">Log in</Link>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        {/* On phones the first screen is the mission alone (headline, sentence, one button); the demo follows
            below the fold, so the headline, not a 960 px image, is what the first paint has to show. */}
        <section className="relative isolate mx-auto flex max-w-3xl flex-col justify-center pb-10 pt-8 text-center md:pb-4 md:pt-20">
          <HeroBackdrop />
          <p className="relative text-12 font-medium uppercase tracking-[0.18em] text-fg-1">A guided literature review</p>
          <h1 className="relative mt-3 text-28 font-semibold md:text-44">Turn a rough idea into a research question you can back up with real papers.</h1>
          <p className="relative mx-auto mt-4 max-w-2xl text-16 text-fg-1">Tell Athena your idea. It finds real papers in PubMed and OpenAlex (two free research libraries), helps you read and judge them, and drafts research questions, with every quote checked against its source. You confirm each of the 9 steps.</p>
          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
            <TransitionLink href="/signup?next=/s/new" className="btn-primary min-h-11 px-6 text-16">Start a review</TransitionLink>
            <Link href="/login" className="btn-secondary min-h-11 px-6 text-16">I have an account</Link>
          </div>
          <p className="relative mt-3 text-12 text-fg-2">Free to try. You get a report, a spreadsheet of papers and a reference list.</p>
        </section>
        <section aria-labelledby="how" className="mx-auto mt-10 max-w-5xl">
          <h2 id="how" className="text-center text-20 font-semibold">How it works: 9 steps, 3 stages</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {PHASES.map((ph, i) => (
              <li key={ph.title} className="overflow-hidden rounded-md border border-line bg-bg-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <figure className="border-b border-line">
                  <img src={`/explainers/stage-${ph.poster}.webp`} alt="" width={640} height={360} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
                  <figcaption className="px-4 pt-2 text-12 text-fg-2">Pictured: step {ph.poster}, {EXPLAINERS[ph.poster - 1].title.toLowerCase()}</figcaption>
                </figure>
                <div className="p-4 pt-2">
                  <p className="text-12 font-medium text-fg-2">Stage {i + 1} of 3 · steps {ph.steps[0]}–{ph.steps[2]}</p>
                  <h3 className="mt-1 text-16 font-semibold">{ph.title}</h3>
                  <p className="mt-1 text-fg-1">{ph.text}</p>
                  <p className="mt-2 text-12 text-fg-2">{ph.steps.map((n) => `${n}. ${EXPLAINERS[n - 1].title}`).join(" · ")}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="demo" className="mt-12">
          <h2 id="demo" className="mb-3 text-center text-20 font-semibold">See a review take shape</h2>
          <DemoVideo />
        </section>
        <section className="mx-auto mt-8 max-w-2xl">
          <Disclosure title="What Athena will not do">
            <ul className="list-disc space-y-2 pl-6 text-fg-1">
              <li>Invent references: every paper comes from a real PubMed, OpenAlex or Crossref record with its identifier.</li>
              <li>Hide what it could not read: every appraisal says whether it used the full text or only the abstract.</li>
              <li>Move on without you: every AI suggestion waits for you to check and approve it.</li>
            </ul>
          </Disclosure>
        </section>
      </main>
    </div>
  );
}
