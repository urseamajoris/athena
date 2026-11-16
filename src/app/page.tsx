import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FileText, ListChecks, Table2 } from "lucide-react";
import { PublicBar } from "@/components/AppChrome";
import { ButtonLink } from "@/components/ui";
import { SESSION_COOKIE } from "@/lib/auth/policy";
import { CREDIT_PACKS, DEFAULT_SIGNUP_CREDITS, formatCredits, formatPrice } from "@/lib/billing/packs";
import { PHASES, stepsOfPhase } from "@/lib/shared/flow";

const OUTPUTS = [
  { icon: FileText, title: "A report", text: "Your question, how you searched, what each article found and what the evidence says together." },
  { icon: Table2, title: "A spreadsheet of papers", text: "Every paper found, with its summary and ranking, to keep working on." },
  { icon: ListChecks, title: "A reference list", text: "Ready to import into your reference manager." },
];

/** Landing: what Athena does, one button, then the four stages, what you get and what it costs. */
export default async function Landing() {
  // Signed-in visitors go straight to their reviews (a cookie check only: no database call on this page).
  if ((await cookies()).get(SESSION_COOKIE)) redirect("/sessions");
  const cheapest = Math.min(...CREDIT_PACKS.map((p) => p.priceCents));
  return (
    <div className="min-h-screen bg-bg-0">
      <PublicBar link={{ href: "/login", label: "Log in" }} />
      <main id="main" className="mx-auto max-w-5xl px-4 pb-20 md:px-6">
        <section className="max-w-3xl pb-14 pt-12 md:pb-20 md:pt-20">
          <h1 className="text-display font-semibold">Go from a rough idea to a finished literature review.</h1>
          <p className="mt-5 max-w-2xl text-fg-1">
            Athena helps you turn your idea into a research question, finds real papers in PubMed and OpenAlex, and analyses each article with you, checking every quote against its source.
          </p>
          <ButtonLink variant="primary" size="lg" href="/signup?next=/s/new" className="mt-8">Start a review</ButtonLink>
        </section>

        <section aria-labelledby="how" className="border-t border-line py-12">
          <h2 id="how" className="font-semibold">How it works: four stages</h2>
          <ol className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {PHASES.map((ph) => (
              <li key={ph.key} className="flex gap-4">
                <span aria-hidden className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-control font-semibold tabular-nums">{ph.n}</span>
                <div>
                  <h3 className="font-semibold">{ph.title}</h3>
                  <p className="text-fg-1">{ph.blurb}.</p>
                  <p className="mt-1 text-small text-fg-2">{stepsOfPhase(ph.key).map((s) => s.title).join(" · ")}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="get" className="border-t border-line py-12">
          <h2 id="get" className="font-semibold">What you get at the end</h2>
          <ul className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-3">
            {OUTPUTS.map((o) => (
              <li key={o.title}>
                <o.icon className="h-6 w-6 text-fg-2" strokeWidth={1.75} aria-hidden />
                <h3 className="mt-3 font-semibold">{o.title}</h3>
                <p className="text-fg-1">{o.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="cost" className="border-t border-line py-12">
          <h2 id="cost" className="font-semibold">What it costs</h2>
          <p className="mt-3 max-w-2xl text-fg-1">
            A new account starts with {formatCredits(DEFAULT_SIGNUP_CREDITS)} free credits. Searching for papers is free. Steps that use AI take credits. When you need more, credit packs start at {formatPrice(cheapest)}.
          </p>
          <ul className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-3">
            {CREDIT_PACKS.map((p) => (
              <li key={p.id} className="card px-4 py-3">
                <p className="font-semibold">{p.name}</p>
                <p className="text-fg-1"><span className="tabular-nums">{formatPrice(p.priceCents)}</span> for <span className="tabular-nums">{formatCredits(p.credits)}</span> credits</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
