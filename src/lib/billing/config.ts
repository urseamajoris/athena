import "server-only";
import { DEFAULT_CREDITS_PER_USD_COST, DEFAULT_SIGNUP_CREDITS } from "./packs";
import { envNumber } from "./rules";

/**
 * Billing settings from the environment, read on every use so a test or a restart with new values sees them.
 * The two Stripe values are secrets: they never go into a response, a log line, the audit log or an export.
 */
export const billingConfig = {
  /** Stripe secret key (sk_test_... or sk_live_...). Empty: buying credits is off; everything else still works. */
  get stripeSecretKey() {
    return process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  },
  /** Signing secret of the Stripe webhook endpoint (whsec_...). Empty: the webhook route refuses every request. */
  get stripeWebhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  },
  /** Public address of this site for Stripe's return links, e.g. https://athena.example.org. Empty: the request's own address. */
  get appUrl() {
    return process.env.APP_URL?.trim() ?? "";
  },
  /** Credits every new account starts with (SIGNUP_FREE_CREDITS; 0 gives none). */
  get signupCredits() {
    return Math.floor(envNumber(process.env.SIGNUP_FREE_CREDITS, DEFAULT_SIGNUP_CREDITS));
  },
  /** Credits taken per US dollar of model cost (CREDITS_PER_USD_COST). */
  get creditsPerUsdCost() {
    return envNumber(process.env.CREDITS_PER_USD_COST, DEFAULT_CREDITS_PER_USD_COST);
  },
};

export const stripeReady = () => !!billingConfig.stripeSecretKey;
