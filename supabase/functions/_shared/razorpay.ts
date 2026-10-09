// Pure Razorpay helpers, kept separate from the HTTP handlers so they can be unit-tested.
const GRACE_SECONDS = 2 * 86400; // covers renewal webhooks arriving late
const FALLBACK_MS = 33 * 86400_000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const ACTIVE = new Set(['subscription.activated', 'subscription.charged', 'subscription.resumed']);
const ENDED = new Set(['subscription.cancelled', 'subscription.completed', 'subscription.halted']);

// deno-lint-ignore no-explicit-any
export function profileUpdateForEvent(event: any, nowMs: number): { userId: string; update: Record<string, unknown> } | null {
  const name = event?.event;
  const sub = event?.payload?.subscription?.entity;
  const userId = sub?.notes?.user_id;
  if (!sub || typeof userId !== 'string' || !userId) return null;
  if (ACTIVE.has(name)) {
    const until = typeof sub.current_end === 'number'
      ? new Date((sub.current_end + GRACE_SECONDS) * 1000)
      : new Date(nowMs + FALLBACK_MS);
    return { userId, update: { plan: 'pro', pro_until: until.toISOString(), razorpay_subscription_id: sub.id } };
  }
  if (ENDED.has(name)) return { userId, update: { plan: 'free', pro_until: null } };
  return null;
}

export type PlanEnv = { usd: string; inr: string; usdYear?: string; inrYear?: string };

// Yearly plan ids are optional; returns '' when that plan isn't configured.
export function planIdFor(currency: string, env: PlanEnv, interval = 'month'): string {
  if (interval === 'year') return (currency === 'INR' ? env.inrYear : env.usdYear) ?? '';
  return currency === 'INR' ? env.inr : env.usd;
}

// One-time credit pack. Amounts are in the smallest unit (paise / cents) and
// must match the prices shown in assets/credits-config.js.
export const CREDIT_PACK = { credits: 100, amounts: { INR: 14900, USD: 200 } as Record<string, number> };

export function packOrderFor(currency: string, userId: string) {
  const cur = currency === 'INR' ? 'INR' : 'USD';
  return {
    amount: CREDIT_PACK.amounts[cur],
    currency: cur,
    notes: { user_id: userId, kind: 'credit_pack', credits: String(CREDIT_PACK.credits) },
  };
}

// order.paid webhook -> credits to grant, only when the paid amount matches
// the pack price for that currency (the notes alone are not trusted).
// deno-lint-ignore no-explicit-any
export function packGrantForEvent(event: any): { orderId: string; userId: string; credits: number } | null {
  if (event?.event !== 'order.paid') return null;
  const order = event?.payload?.order?.entity;
  const notes = order?.notes;
  if (!order || notes?.kind !== 'credit_pack' || typeof notes.user_id !== 'string' || !notes.user_id) return null;
  if (typeof order.id !== 'string' || order.status !== 'paid') return null;
  const expected = CREDIT_PACK.amounts[order.currency];
  if (!expected || order.amount_paid !== expected) return null;
  return { orderId: order.id, userId: notes.user_id, credits: CREDIT_PACK.credits };
}

// A subscription the user opened but never paid ('created') on the same plan
// can be handed to Checkout again instead of creating another one.
// deno-lint-ignore no-explicit-any
export function reusableSubscriptionId(sub: any, planId: string): string | null {
  return sub && sub.status === 'created' && sub.plan_id === planId && typeof sub.id === 'string' ? sub.id : null;
}
