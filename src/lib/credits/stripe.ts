import "server-only";
import { config } from "../config";
import { HttpError } from "../project";
import { formatTokens, type CreditPack } from "../shared/credits";
import { redactSecrets } from "../auth/secrets";

export { verifyStripeSignature, parseStripeSignatureHeader } from "./stripe-signature";

export function isStripeCheckoutConfigured(): boolean {
  return !!config.stripeSecretKey.trim();
}

export function paymentLinkForPack(packId: string, user?: { id: string; email: string }): string | null {
  const raw = (config.stripePaymentLinks[packId] ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (user?.email) u.searchParams.set("prefilled_email", user.email);
    if (user?.id) u.searchParams.set("client_reference_id", user.id);
    return u.toString();
  } catch {
    return null;
  }
}

export function isStripeConfigured(): boolean {
  if (isStripeCheckoutConfigured()) return true;
  return Object.values(config.stripePaymentLinks).some((v) => !!v.trim());
}

export interface StripeCheckoutResult {
  url: string;
  sessionId: string | null;
  mode: "checkout" | "payment_link";
}

/**
 * Create a Stripe Checkout Session for a credit pack, or fall back to a pre-configured Stripe Payment Link.
 */
export async function createStripeCheckoutSession(params: {
  pack: CreditPack;
  user: { id: string; email: string };
  origin: string;
}): Promise<StripeCheckoutResult> {
  const key = config.stripeSecretKey.trim();
  if (!key) {
    const link = paymentLinkForPack(params.pack.id, params.user);
    if (link) return { url: link, sessionId: null, mode: "payment_link" };
    throw new HttpError(
      503,
      "Stripe payments are not configured on this server yet. Set STRIPE_SECRET_KEY (or STRIPE_PAYMENT_LINK_*) in the environment.",
    );
  }

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${params.origin}/credits?status=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${params.origin}/credits?status=cancelled`);
  form.set("customer_email", params.user.email);
  form.set("client_reference_id", params.user.id);
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(params.pack.priceCents));
  form.set("line_items[0][price_data][product_data][name]", `Athena Literature Review Credits — ${params.pack.name}`);
  form.set(
    "line_items[0][price_data][product_data][description]",
    `${params.pack.credits.toLocaleString("en-US")} literature review credits (~${formatTokens(params.pack.approxTokens)} tokens)`,
  );
  form.set("line_items[0][quantity]", "1");
  form.set("metadata[userId]", params.user.id);
  form.set("metadata[packId]", params.pack.id);
  form.set("metadata[credits]", String(params.pack.credits));

  const res = await fetch(`${config.stripeApiBaseUrl}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const safe = redactSecrets(body.slice(0, 300), [key]);
    throw new HttpError(502, `Stripe Checkout could not be started (HTTP ${res.status}): ${safe}`);
  }

  const data = (await res.json()) as { id?: string; url?: string | null };
  if (!data.url) {
    throw new HttpError(502, "Stripe did not return a payment page URL.");
  }
  return { url: data.url, sessionId: data.id ?? null, mode: "checkout" };
}

export interface StripeCheckoutSessionInfo {
  id: string;
  paymentStatus: string;
  amountTotal: number | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
}

/** Fetch an existing Stripe Checkout Session to verify payment after the user returns from Stripe. */
export async function fetchStripeCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionInfo> {
  const key = config.stripeSecretKey.trim();
  if (!key) {
    throw new HttpError(503, "Stripe is not configured on this server.");
  }
  const res = await fetch(`${config.stripeApiBaseUrl}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const safe = redactSecrets(body.slice(0, 300), [key]);
    throw new HttpError(502, `Could not verify Stripe payment (HTTP ${res.status}): ${safe}`);
  }
  const data = (await res.json()) as {
    id: string;
    payment_status?: string;
    amount_total?: number | null;
    client_reference_id?: string | null;
    metadata?: Record<string, string>;
  };
  return {
    id: data.id,
    paymentStatus: data.payment_status ?? "unpaid",
    amountTotal: data.amount_total ?? null,
    clientReferenceId: data.client_reference_id ?? null,
    metadata: data.metadata ?? {},
  };
}
