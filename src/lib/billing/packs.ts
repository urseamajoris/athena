// Shared between server and client (no Node APIs, no secrets here).
//
// Computing credits. One credit is worth about one US cent of AI work at the Starter price. AI steps take credits
// from the account that owns the project; nothing else costs credits (searching PubMed and OpenAlex is free).

export interface CreditPack {
  id: "starter" | "plus" | "pro";
  name: string;
  /** Price in US cents (Stripe's unit). */
  priceCents: number;
  credits: number;
  /** Extra credits over the Starter rate, as a whole percentage (0 = none). */
  bonusPercent: number;
  blurb: string;
  /** Shown as the suggested choice. */
  featured?: boolean;
}

/** Starter is 100 credits per dollar; larger packs add a bonus. */
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", name: "Starter", priceCents: 500, credits: 500, bonusPercent: 0, blurb: "Enough to try a full review" },
  { id: "plus", name: "Plus", priceCents: 1500, credits: 1650, bonusPercent: 10, blurb: "A few reviews", featured: true },
  { id: "pro", name: "Pro", priceCents: 4000, credits: 4800, bonusPercent: 20, blurb: "Best value for regular use" },
];

/** Every pack is priced in US dollars (Stripe's lower-case currency code). */
export const CREDIT_CURRENCY = "usd";

export function packById(id: unknown, packs: readonly CreditPack[] = CREDIT_PACKS): CreditPack | undefined {
  return packs.find((p) => p.id === id);
}

/** Was exactly this pack's price paid, in the packs' currency? Amounts are in cents. */
export function paidForPack(pack: CreditPack, amountCents: number | null | undefined, currency: string | null | undefined): boolean {
  return amountCents === pack.priceCents && (currency ?? "").toLowerCase() === CREDIT_CURRENCY;
}

/** Credits given to every new account. Override with SIGNUP_FREE_CREDITS on the server. */
export const DEFAULT_SIGNUP_CREDITS = 100;
/** Credits taken per US dollar of model cost. Override with CREDITS_PER_USD_COST on the server. */
export const DEFAULT_CREDITS_PER_USD_COST = 150;

export function creditsPerDollar(pack: CreditPack): number {
  return Math.round(pack.credits / (pack.priceCents / 100));
}

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Balance as shown to people: whole credits, never below zero, with thousands separators. */
export function formatCredits(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}
