"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Coins, CreditCard, ExternalLink, Info, Sparkles } from "lucide-react";
import { api, useApi } from "../api";
import { ErrorState, Loading, Spinner, cx } from "../ui";
import { AppMenu } from "../AppMenu";
import { LogoMark } from "../Logo";
import {
  CHARS_PER_TOKEN,
  STAGE_PROFILES,
  TOKENS_PER_CREDIT,
  formatCredits,
  formatTokens,
  formatUsd,
  type CreditPack,
} from "@/lib/shared/credits";

interface PackOption extends CreditPack {
  available: boolean;
  paymentLinkUrl: string | null;
}

interface CreditTransactionRow {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  stage: number | null;
  operation: string;
  operationLabel: string;
  amount: number;
  balanceAfter: number;
  articleCount: number | null;
  totalChars: number | null;
  approxTokens: number | null;
  amountCents: number | null;
  description: string;
  createdAt: string;
}

interface CreditsResponse {
  balance: number;
  stripeConfigured: boolean;
  stripeMode: "checkout" | "payment_link" | "unconfigured";
  packs: PackOption[];
  summary: {
    totalUsed: number;
    totalToppedUp: number;
    totalApproxTokens: number;
    totalArticlesProcessed: number;
  };
  transactions: CreditTransactionRow[];
}

export function CreditsView() {
  const { data, error, mutate } = useApi<CreditsResponse>("/api/credits");
  const params = useSearchParams();
  const statusParam = params.get("status");
  const sessionIdParam = params.get("session_id");

  const [checkoutPackId, setCheckoutPackId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [verifyBanner, setVerifyBanner] = useState<{ kind: "ok" | "info" | "err"; text: string } | null>(null);
  const verifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (statusParam === "cancelled") {
      setVerifyBanner({ kind: "info", text: "Stripe checkout was cancelled. No charge was made." });
      return;
    }
    if (statusParam === "success" && sessionIdParam && verifiedRef.current !== sessionIdParam) {
      verifiedRef.current = sessionIdParam;
      void (async () => {
        try {
          const res = await api<{ paid: boolean; alreadyApplied?: boolean; creditsAdded?: number; balance?: number; resumedJobs?: number }>("/api/credits/verify", {
            body: { sessionId: sessionIdParam },
          });
          if (res.paid) {
            const added = res.creditsAdded ?? 0;
            const resumedNote = res.resumedJobs ? ` ${res.resumedJobs} paused job${res.resumedJobs === 1 ? "" : "s"} resumed automatically.` : "";
            setVerifyBanner({
              kind: "ok",
              text: res.alreadyApplied
                ? `Payment confirmed. Your credit balance is ${formatCredits(res.balance ?? 0)} credits.`
                : `Payment confirmed! Added ${formatCredits(added)} credits (new balance: ${formatCredits(res.balance ?? 0)}).${resumedNote}`,
            });
            await mutate();
          } else {
            setVerifyBanner({ kind: "info", text: "Payment is still processing with Stripe. Refresh shortly if your balance has not updated yet." });
          }
        } catch (err) {
          setVerifyBanner({ kind: "err", text: (err as Error).message });
        }
      })();
    }
  }, [statusParam, sessionIdParam, mutate]);

  async function startTopUp(pack: PackOption) {
    setCheckoutError(null);
    if (pack.paymentLinkUrl) {
      window.location.assign(pack.paymentLinkUrl);
      return;
    }
    setCheckoutPackId(pack.id);
    try {
      const res = await api<{ url: string }>("/api/credits/checkout", { body: { packId: pack.id } });
      window.location.assign(res.url);
    } catch (err) {
      setCheckoutError((err as Error).message);
      setCheckoutPackId(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-line px-2 md:px-4">
        <Link href="/sessions" className="btn-ghost h-11">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> My projects
        </Link>
        <Link href="/" className="inline-flex h-11 items-center gap-2 px-1 font-semibold max-sm:hidden" aria-label="Athena home">
          <LogoMark />
        </Link>
        <AppMenu />
      </header>

      <main id="main" className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-24 font-semibold">Literature review credits</h1>
            <p className="mt-1 text-fg-1">
              Credits cover data gathering, summarizing, ranking, and literature review result generation, calculated from the number and size of articles in approximate tokens.
            </p>
          </div>
          <Link href="/account" className="btn-secondary min-h-11">
            Account settings
          </Link>
        </div>

        {verifyBanner && (
          <div
            role={verifyBanner.kind === "err" ? "alert" : "status"}
            className={cx(
              "mt-4 flex items-start gap-2 rounded-md border px-4 py-3 text-14",
              verifyBanner.kind === "ok"
                ? "border-ok-line bg-ok-soft text-fg-0"
                : verifyBanner.kind === "err"
                  ? "border-err-line bg-err-soft text-fg-0"
                  : "border-line bg-bg-1 text-fg-0",
            )}
          >
            {verifyBanner.kind === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-hidden />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-fg-2" strokeWidth={2} aria-hidden />
            )}
            <p>{verifyBanner.text}</p>
          </div>
        )}

        {!data && !error && <div className="mt-6"><Loading label="Loading credit balance…" /></div>}
        {error && <div className="mt-6"><ErrorState error={error} onRetry={() => mutate()} /></div>}

        {data && (
          <div className="mt-6 space-y-6">
            {/* Balance & Usage Summary */}
            <section aria-labelledby="balance-heading" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <h2 id="balance-heading" className="sr-only">Credit balance summary</h2>
              <div className="rounded-md border border-line bg-bg-1 p-4">
                <div className="flex items-center gap-2 text-12 text-fg-2">
                  <Coins className="h-4 w-4 text-accent" strokeWidth={1.75} aria-hidden />
                  Available balance
                </div>
                <p className="mt-2 text-28 font-semibold tabular-nums text-fg-0">{formatCredits(data.balance)}</p>
                <p className="mt-1 text-12 text-fg-2 tabular-nums">
                  ~{formatTokens(data.balance * TOKENS_PER_CREDIT)} approx. tokens
                </p>
              </div>
              <div className="rounded-md border border-line bg-bg-1 p-4">
                <div className="text-12 text-fg-2">Credits used</div>
                <p className="mt-2 text-24 font-semibold tabular-nums text-fg-0">{formatCredits(data.summary.totalUsed)}</p>
                <p className="mt-1 text-12 text-fg-2 tabular-nums">
                  {formatCredits(data.summary.totalToppedUp)} topped up
                </p>
              </div>
              <div className="rounded-md border border-line bg-bg-1 p-4">
                <div className="text-12 text-fg-2">Approx. tokens processed</div>
                <p className="mt-2 text-24 font-semibold tabular-nums text-fg-0">{formatTokens(data.summary.totalApproxTokens)}</p>
                <p className="mt-1 text-12 text-fg-2">1 credit = {formatCredits(TOKENS_PER_CREDIT)} tokens</p>
              </div>
              <div className="rounded-md border border-line bg-bg-1 p-4">
                <div className="text-12 text-fg-2">Articles processed</div>
                <p className="mt-2 text-24 font-semibold tabular-nums text-fg-0">{formatCredits(data.summary.totalArticlesProcessed)}</p>
                <p className="mt-1 text-12 text-fg-2">Across all review stages</p>
              </div>
            </section>

            {/* Top-Up Packs */}
            <section aria-labelledby="topup-heading" className="rounded-md border border-line bg-bg-1 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 id="topup-heading" className="text-16 font-semibold">Top up credits via Stripe</h2>
                  <p className="mt-1 text-14 text-fg-1">
                    Choose a credit pack below to continue to the secure Stripe payment page. Credits are added to your account immediately after payment.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-2 px-3 py-1 text-12 text-fg-1">
                  <CreditCard className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  Secured by Stripe
                </span>
              </div>

              {!data.stripeConfigured && (
                <div role="status" className="mt-4 rounded-md border border-warn-line bg-warn-soft px-4 py-3 text-13 text-fg-0">
                  Stripe checkout is not configured on this server yet. An administrator can set <code className="font-mono">STRIPE_SECRET_KEY</code> (or <code className="font-mono">STRIPE_PAYMENT_LINK_*</code>) in the server environment to enable live payments.
                </div>
              )}

              {checkoutError && (
                <p role="alert" className="mt-4 rounded-md border border-err-line bg-err-soft px-4 py-3 text-13 text-err">
                  {checkoutError}
                </p>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {data.packs.map((pack) => {
                  const busy = checkoutPackId === pack.id;
                  const disabled = !pack.available || checkoutPackId !== null;
                  return (
                    <div
                      key={pack.id}
                      className={cx(
                        "flex flex-col rounded-md border p-4",
                        pack.popular ? "border-accent bg-bg-2" : "border-line bg-bg-0",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-fg-0">{pack.name}</h3>
                        {pack.popular && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-11 font-medium text-accent">
                            <Sparkles className="h-3 w-3" aria-hidden /> Popular
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-24 font-semibold tabular-nums text-fg-0">{formatUsd(pack.priceCents)}</p>
                      <p className="mt-1 text-14 font-medium tabular-nums text-fg-1">
                        {formatCredits(pack.credits)} credits
                      </p>
                      <p className="text-12 tabular-nums text-fg-2">
                        ~{formatTokens(pack.approxTokens)} approx. tokens
                      </p>
                      <p className="mt-2 flex-1 text-12 text-fg-2">{pack.tagline}</p>
                      <button
                        type="button"
                        className={cx("mt-4 min-h-11 w-full justify-center", pack.popular ? "btn-primary" : "btn-secondary")}
                        disabled={disabled}
                        onClick={() => void startTopUp(pack)}
                      >
                        {busy ? (
                          <>
                            <Spinner /> Redirecting…
                          </>
                        ) : (
                          <>
                            Pay with Stripe <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Formula explanation */}
            <section aria-labelledby="formula-heading" className="rounded-md border border-line bg-bg-1 p-5">
              <h2 id="formula-heading" className="text-16 font-semibold">How literature review credits are calculated</h2>
              <p className="mt-1 text-14 text-fg-1">
                Every stage calculates approximate tokens from the total number of articles gathered and their combined text size (~{CHARS_PER_TOKEN} characters per token, plus stage prompt and structured output tokens). Every <span className="font-medium text-fg-0">{formatCredits(TOKENS_PER_CREDIT)} approximate tokens</span> uses <span className="font-medium text-fg-0">1 credit</span> (minimum 1 credit per non-empty run).
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-13">
                  <thead className="text-12 text-fg-2">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3 font-medium">Operation</th>
                      <th className="py-2 px-3 font-medium">Stage</th>
                      <th className="py-2 px-3 text-right font-medium">Prompt / metadata overhead</th>
                      <th className="py-2 pl-3 text-right font-medium">Est. output / article</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(STAGE_PROFILES).map(([key, prof]) => (
                      <tr key={key} className="border-t border-line">
                        <td className="py-2 pr-3 font-medium text-fg-0">{prof.label}</td>
                        <td className="py-2 px-3 text-fg-2">Step {prof.stage}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-fg-1">+{prof.inputOverheadPerArticle} tok/article</td>
                        <td className="py-2 pl-3 text-right tabular-nums text-fg-1">
                          {prof.outputPerArticle > 0 ? `~${prof.outputPerArticle} tok` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Transaction Ledger */}
            <section aria-labelledby="ledger-heading" className="rounded-md border border-line bg-bg-1 p-5">
              <h2 id="ledger-heading" className="text-16 font-semibold">Credit history</h2>
              {data.transactions.length === 0 ? (
                <p className="mt-2 text-14 text-fg-2">No credit transactions yet. Usage will appear here as you run literature reviews or top up credits.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-13">
                    <caption className="sr-only">Literature review credit transactions</caption>
                    <thead className="text-12 text-fg-2">
                      <tr className="border-b border-line">
                        <th className="py-2 pr-3 font-medium">Date</th>
                        <th className="py-2 px-3 font-medium">Activity</th>
                        <th className="py-2 px-3 text-right font-medium">Articles</th>
                        <th className="py-2 px-3 text-right font-medium">Approx. tokens</th>
                        <th className="py-2 px-3 text-right font-medium">Credits</th>
                        <th className="py-2 pl-3 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.transactions.map((tx) => (
                        <tr key={tx.id} className="border-t border-line">
                          <td className="py-2 pr-3 whitespace-nowrap text-fg-2" suppressHydrationWarning>
                            {new Date(tx.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-medium text-fg-0">{tx.operationLabel}</span>
                            {tx.projectId && (
                              <Link className="link ml-2 text-12" href={`/s/${tx.projectId}`}>
                                {tx.projectTitle || "View project"}
                              </Link>
                            )}
                            <span className="block text-12 text-fg-2">{tx.description}</span>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-fg-1">
                            {tx.articleCount !== null ? formatCredits(tx.articleCount) : "—"}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-fg-1">
                            {tx.approxTokens !== null ? `~${formatTokens(tx.approxTokens)}` : "—"}
                          </td>
                          <td
                            className={cx(
                              "py-2 px-3 text-right font-medium tabular-nums",
                              tx.amount > 0 ? "text-ok" : "text-fg-0",
                            )}
                          >
                            {tx.amount > 0 ? `+${formatCredits(tx.amount)}` : formatCredits(tx.amount)}
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums text-fg-2">
                            {formatCredits(tx.balanceAfter)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
