import "server-only";
import { and, eq, gte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { HttpError } from "../project";
import { audit, type SessionUser } from "../auth/server";
import { billingConfig, stripeReady } from "../billing/config";
import { addCredits } from "../billing/credits";
import { shownBalance } from "../billing/rules";

/** The most credits one grant may add or remove. */
export const MAX_GRANT = 100_000;

/**
 * An administrator adds credits to an account (positive) or removes them (negative). Removing stops at what the
 * account has: a grant never takes a balance below zero.
 */
export async function grantCredits(admin: SessionUser, userId: string, credits: number, note: string) {
  const u = await db.select({ id: schema.users.id, balance: schema.users.creditBalance }).from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!u) throw new HttpError(404, "Account not found");
  const has = shownBalance(u.balance);
  if (credits < 0 && -credits > has) throw new HttpError(409, `This account has ${Math.floor(has).toLocaleString("en-US")} credits, so that is the most you can remove.`);
  const r = await addCredits(u.id, credits, { kind: "grant", actorId: admin.id, note: note || null });
  await audit("admin", credits > 0 ? "credits_granted" : "credits_removed", { actorId: admin.id, targetId: u.id, detail: { credits, note: note || null, balance: shownBalance(r.balance) } });
  return { ok: true, balance: shownBalance(r.balance) };
}

export interface CreditTotals {
  /** Completed purchases. */
  purchases: number;
  creditsSold: number;
  /** US dollars taken for purchases, before refunds. */
  revenueUsd: number;
  /** US dollars returned to buyers (a positive number). */
  refundsUsd: number;
  /** Credits taken back by refunds (a positive number). */
  creditsRefunded: number;
  /** Credits given without payment: sign-up credits plus what administrators added. */
  creditsGrantedFree: number;
  /** Credits administrators took away (a positive number). */
  creditsRemoved: number;
  /** Credits taken by AI calls. */
  creditsUsed: number;
  /** What every AI call cost at the model provider, in US dollars (administrators' calls included). */
  modelCostUsd: number;
  /** The part of modelCostUsd that was paid for with credits. */
  modelCostChargedUsd: number;
  /** revenueUsd - refundsUsd - modelCostUsd. */
  marginUsd: number;
}

export interface AdminCredits {
  stripeReady: boolean;
  /** Is STRIPE_WEBHOOK_SECRET set? Without it purchases are only credited when the buyer returns to the site. */
  webhookReady: boolean;
  creditsPerUsdCost: number;
  signupCredits: number;
  last30Days: CreditTotals;
  allTime: CreditTotals;
  /** Credits people still hold: the sum of every balance above zero (administrators' included). */
  outstandingCredits: number;
  /** User ID -> balance (never below 0), for the users table. */
  balances: Record<string, number>;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

async function totals(sinceIso: string | null): Promise<CreditTotals> {
  const L = schema.creditLedger;
  const A = schema.aiCalls;
  const ledger = await db
    .select({ kind: L.kind, added: sql<number>`coalesce(sum(case when ${L.credits} > 0 then ${L.credits} else 0 end),0)`, removed: sql<number>`coalesce(sum(case when ${L.credits} < 0 then -${L.credits} else 0 end),0)`, usd: sql<number>`coalesce(sum(${L.amountUsd}),0)`, rows: sql<number>`count(*)` })
    .from(L)
    .where(sinceIso ? gte(L.createdAt, sinceIso) : undefined)
    .groupBy(L.kind)
    .all();
  const of = (kind: string) => ledger.find((r) => r.kind === kind) ?? { added: 0, removed: 0, usd: 0, rows: 0 };
  const sent = notInArray(A.status, ["refused", "paused"]);
  const ai = await db
    .select({ credits: sql<number>`coalesce(sum(${A.credits}),0)`, cost: sql<number>`coalesce(sum(${A.costUsd}),0)`, charged: sql<number>`coalesce(sum(case when ${A.credits} > 0 then ${A.costUsd} else 0 end),0)` })
    .from(A)
    .where(sinceIso ? and(sent, gte(A.createdAt, sinceIso)) : sent)
    .get();
  const revenueUsd = of("purchase").usd;
  // Refund rows hold what went back as a negative amount; a reversed refund holds it as a positive one.
  const refundsUsd = -of("refund").usd;
  const modelCostUsd = ai?.cost ?? 0;
  return {
    purchases: of("purchase").rows,
    creditsSold: round(of("purchase").added, 3),
    revenueUsd: round(revenueUsd, 2),
    refundsUsd: round(refundsUsd, 2),
    creditsRefunded: round(of("refund").removed - of("refund").added, 3),
    creditsGrantedFree: round(of("signup").added + of("grant").added, 3),
    creditsRemoved: round(of("grant").removed, 3),
    creditsUsed: round(ai?.credits ?? 0, 3),
    modelCostUsd: round(modelCostUsd, 4),
    modelCostChargedUsd: round(ai?.charged ?? 0, 4),
    marginUsd: round(revenueUsd - refundsUsd - modelCostUsd, 2),
  };
}

/** GET /api/admin/credits: what was sold, given and used, and every account's balance. Aggregates only. */
export async function adminCredits(now = Date.now()): Promise<AdminCredits> {
  const [last30Days, allTime, users] = await Promise.all([
    totals(new Date(now - 30 * 86_400_000).toISOString()),
    totals(null),
    db.select({ id: schema.users.id, balance: schema.users.creditBalance }).from(schema.users).all(),
  ]);
  const balances: Record<string, number> = {};
  for (const u of users) balances[u.id] = shownBalance(u.balance);
  return {
    stripeReady: stripeReady(),
    webhookReady: !!billingConfig.stripeWebhookSecret,
    creditsPerUsdCost: billingConfig.creditsPerUsdCost,
    signupCredits: billingConfig.signupCredits,
    last30Days,
    allTime,
    outstandingCredits: round(Object.values(balances).reduce((a, b) => a + b, 0), 3),
    balances,
  };
}
