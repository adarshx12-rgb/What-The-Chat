import { assertEquals } from 'jsr:@std/assert@1';
import { CREDIT_PACK, packGrantForEvent, packOrderFor, planIdFor, profileUpdateForEvent, reusableSubscriptionId, verifySignature } from './razorpay.ts';
import { corsHeaders } from './cors.ts';

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

Deno.test('planIdFor picks the yearly plan, or nothing when it is not configured', () => {
  const env = { usd: 'plan_usd', inr: 'plan_inr', usdYear: 'plan_usd_y', inrYear: 'plan_inr_y' };
  assertEquals(planIdFor('USD', env, 'year'), 'plan_usd_y');
  assertEquals(planIdFor('INR', env, 'year'), 'plan_inr_y');
  assertEquals(planIdFor('INR', { usd: 'a', inr: 'b' }, 'year'), '');
  assertEquals(planIdFor('INR', env, 'month'), 'plan_inr');
});

function orderEvent(extra: Record<string, unknown> = {}) {
  return { event: 'order.paid', payload: { order: { entity: {
    id: 'order_1', status: 'paid', currency: 'INR', amount_paid: CREDIT_PACK.amounts.INR,
    notes: { user_id: 'u-1', kind: 'credit_pack', credits: '100' }, ...extra,
  } } } };
}

Deno.test('a paid pack order grants the pack credits', () => {
  assertEquals(packGrantForEvent(orderEvent()), { orderId: 'order_1', userId: 'u-1', credits: CREDIT_PACK.credits });
  assertEquals(packGrantForEvent(orderEvent({ currency: 'USD', amount_paid: CREDIT_PACK.amounts.USD }))?.credits, CREDIT_PACK.credits);
});

Deno.test('pack orders with a wrong amount, kind, status or user are ignored', () => {
  assertEquals(packGrantForEvent(orderEvent({ amount_paid: 100 })), null);
  assertEquals(packGrantForEvent(orderEvent({ currency: 'EUR' })), null);
  assertEquals(packGrantForEvent(orderEvent({ status: 'attempted' })), null);
  assertEquals(packGrantForEvent(orderEvent({ notes: { user_id: 'u-1', kind: 'other' } })), null);
  assertEquals(packGrantForEvent(orderEvent({ notes: { kind: 'credit_pack' } })), null);
  assertEquals(packGrantForEvent({ ...orderEvent(), event: 'payment.captured' }), null);
});

Deno.test('packOrderFor prices by currency and tags the order', () => {
  const o = packOrderFor('INR', 'u-1');
  assertEquals(o.amount, CREDIT_PACK.amounts.INR);
  assertEquals(o.notes, { user_id: 'u-1', kind: 'credit_pack', credits: String(CREDIT_PACK.credits) });
  assertEquals(packOrderFor('EUR', 'u-1').currency, 'USD');
});

Deno.test('CORS only echoes allowed origins', () => {
  assertEquals(corsHeaders('https://whatthechat.com')['access-control-allow-origin'], 'https://whatthechat.com');
  assertEquals(corsHeaders('http://127.0.0.1:8090')['access-control-allow-origin'], 'http://127.0.0.1:8090');
  assertEquals(corsHeaders('https://evil.example')['access-control-allow-origin'], 'https://whatthechat.com');
  assertEquals(corsHeaders(null)['access-control-allow-origin'], 'https://whatthechat.com');
  assertEquals(corsHeaders('https://staging.example', 'https://staging.example')['access-control-allow-origin'], 'https://staging.example');
});

Deno.test('an unpaid subscription on the same plan is reused; anything else is not', () => {
  assertEquals(reusableSubscriptionId({ id: 'sub_1', status: 'created', plan_id: 'plan_usd' }, 'plan_usd'), 'sub_1');
  assertEquals(reusableSubscriptionId({ id: 'sub_1', status: 'created', plan_id: 'plan_inr' }, 'plan_usd'), null);
  for (const status of ['active', 'authenticated', 'cancelled', 'completed', 'expired', 'halted', 'pending']) {
    assertEquals(reusableSubscriptionId({ id: 'sub_1', status, plan_id: 'plan_usd' }, 'plan_usd'), null, status);
  }
  assertEquals(reusableSubscriptionId(null, 'plan_usd'), null);
  assertEquals(reusableSubscriptionId({ error: { code: 'BAD_REQUEST_ERROR' } }, 'plan_usd'), null);
});
