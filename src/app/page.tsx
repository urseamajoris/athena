import { LogoMark } from "@/components/Logo";
import Link from "next/link";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { Disclosure } from "@/components/disclosure";
import { TransitionLink } from "@/components/vt";
import { preload } from "react-dom";
import { POSTER, POSTER_SET, POSTER_SIZES } from "@/components/landing/poster";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/policy";

/** Landing: one sentence, one call to action, one demo. */
export default async function Landing() {
  // Signed-in visitors go straight to their projects (a cookie check only: no database call on the landing page).
  if ((await cookies()).get(SESSION_COOKIE)) redirect("/sessions");
  // The poster is the largest thing on the page: request it from the head, before the scripts.
  preload(POSTER, { as: "image", fetchPriority: "high", imageSrcSet: POSTER_SET, imageSizes: POSTER_SIZES });
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
        <section className="mx-auto flex max-w-3xl flex-col justify-center pb-12 pt-12 text-center max-md:min-h-[calc(100svh-3rem)] md:pb-0 md:pt-20">
          <h1 className="text-28 font-semibold md:text-44">Turn a rough idea into a research question you can defend.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-16 text-fg-1">Athena searches PubMed and OpenAlex, reads the papers with you, and checks every quote against its source, so each step is yours to confirm.</p>
          <div className="mt-8">
            <TransitionLink href="/signup?next=/s/new" className="btn-primary min-h-11 px-6 text-16">Start a review</TransitionLink>
          </div>
        </section>
        <section aria-label="Demo" className="md:mt-16">
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
