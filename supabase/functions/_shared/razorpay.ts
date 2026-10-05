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

export function planIdFor(currency: string, env: { usd: string; inr: string }): string {
  return currency === 'INR' ? env.inr : env.usd;
}

// A subscription the user opened but never paid ('created') on the same plan
// can be handed to Checkout again instead of creating another one.
// deno-lint-ignore no-explicit-any
export function reusableSubscriptionId(sub: any, planId: string): string | null {
  return sub && sub.status === 'created' && sub.plan_id === planId && typeof sub.id === 'string' ? sub.id : null;
}
