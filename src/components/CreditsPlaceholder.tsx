"use client";
import { PageHeader, PageShell } from "./AppChrome";
import { useCredits } from "./credits";
import { ButtonLink, Card } from "./ui";
import { formatCredits } from "@/lib/billing/packs";

/** /credits until buying is built: the balance, and what credits are for. */
export function CreditsPlaceholder() {
  const credits = useCredits();
  return (
    <PageShell width="narrow">
      <PageHeader title="Credits" lead="Credits pay for the steps that use AI. Searching for papers is free." />
      <Card className="mt-8">
        <p className="text-small font-semibold text-fg-2">Your balance</p>
        <p className="mt-1 text-headline font-semibold tabular-nums">{credits ? (credits.exempt ? "Unlimited" : `${formatCredits(credits.balance)} credits`) : "Not available right now"}</p>
      </Card>
      <p className="mt-6 text-fg-1">You will be able to buy more credits here soon.</p>
      <ButtonLink variant="primary" href="/sessions" className="mt-6">Go to my reviews</ButtonLink>
    </PageShell>
  );
}
