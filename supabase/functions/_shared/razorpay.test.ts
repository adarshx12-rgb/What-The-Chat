import { assertEquals } from 'jsr:@std/assert@1';
import { planIdFor, profileUpdateForEvent, verifySignature } from './razorpay.ts';

const BODY = '{"event":"subscription.activated"}';
// node -e "require('crypto').createHmac('sha256','whsec_test').update(BODY).digest('hex')"
const GOOD = '6c4e19e38460fae8f4601dac74f96160b0e87dcf18b54ff056a6581dd1b8e7ea';

Deno.test('verifySignature accepts the right HMAC and rejects others', async () => {
  assertEquals(await verifySignature(BODY, GOOD, 'whsec_test'), true);
  assertEquals(await verifySignature(BODY, GOOD, 'other'), false);
  assertEquals(await verifySignature(BODY + ' ', GOOD, 'whsec_test'), false);
  assertEquals(await verifySignature(BODY, '', 'whsec_test'), false);
});

function subEvent(event: string, extra: Record<string, unknown> = {}) {
  return { event, payload: { subscription: { entity: {
    id: 'sub_123', status: 'active', current_end: 1_800_000_000, notes: { user_id: 'u-1' }, ...extra,
  } } } };
}

Deno.test('activation and renewal grant pro until current_end + 2 days grace', () => {
  for (const name of ['subscription.activated', 'subscription.charged', 'subscription.resumed']) {
    const r = profileUpdateForEvent(subEvent(name), 0)!;
    assertEquals(r.userId, 'u-1');
    assertEquals(r.update.plan, 'pro');
    assertEquals(r.update.razorpay_subscription_id, 'sub_123');
    assertEquals(r.update.pro_until, new Date((1_800_000_000 + 2 * 86400) * 1000).toISOString());
  }
});

Deno.test('missing current_end falls back to 33 days from now', () => {
  const r = profileUpdateForEvent(subEvent('subscription.charged', { current_end: null }), 1_000_000)!;
  assertEquals(r.update.pro_until, new Date(1_000_000 + 33 * 86400_000).toISOString());
});

Deno.test('cancelled, completed and halted end pro', () => {
  for (const name of ['subscription.cancelled', 'subscription.completed', 'subscription.halted']) {
    const r = profileUpdateForEvent(subEvent(name), 0)!;
    assertEquals(r.update, { plan: 'free', pro_until: null });
  }
});

Deno.test('unknown events and events without user_id are ignored', () => {
  assertEquals(profileUpdateForEvent(subEvent('subscription.pending'), 0), null);
  assertEquals(profileUpdateForEvent(subEvent('subscription.charged', { notes: {} }), 0), null);
  assertEquals(profileUpdateForEvent({ event: 'payment.captured' }, 0), null);
  assertEquals(profileUpdateForEvent(null, 0), null);
});

Deno.test('planIdFor picks by currency', () => {
  const env = { usd: 'plan_usd', inr: 'plan_inr' };
  assertEquals(planIdFor('USD', env), 'plan_usd');
  assertEquals(planIdFor('INR', env), 'plan_inr');
  assertEquals(planIdFor('EUR', env), 'plan_usd');
});
