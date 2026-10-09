import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { cancellableStatus, packOrderFor, planIdFor, reusableSubscriptionId } from '../_shared/razorpay.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Per-user limit on billing calls (each one can hit the Razorpay API).
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 600;

function razorpayAuth() {
  return 'Basic ' + btoa(`${Deno.env.get('RAZORPAY_KEY_ID')}:${Deno.env.get('RAZORPAY_KEY_SECRET')}`);
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const CORS = corsHeaders(req.headers.get('origin'), Deno.env.get('ALLOWED_ORIGINS') ?? '');
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'not_signed_in' }, 401);
  if (user.is_anonymous) return json({ error: 'sign_in_required' }, 403);

  const { data: rateOk, error: rateErr } = await admin.rpc('billing_rate_ok', {
    p_user: user.id, p_limit: RATE_LIMIT, p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (rateErr) { console.error('rate check failed', rateErr.message); return json({ error: 'server_error' }, 500); }
  if (!rateOk) return json({ error: 'rate_limited' }, 429);

  const body = await req.json().catch(() => ({}));

  if (body.action === 'pack') {
    const order = packOrderFor(body.currency, user.id);
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
    const created = await res.json();
    if (!res.ok) { console.error('razorpay order failed', created); return json({ error: 'razorpay_error' }, 502); }
    return json({ order_id: created.id, amount: created.amount, currency: created.currency, key_id: Deno.env.get('RAZORPAY_KEY_ID') });
  }

  const { data: profile } = await admin.from('profiles').select('*').eq('user_id', user.id).single();

  // Self-serve account deletion. A live subscription is cancelled first (no
  // more charges), then the auth user is deleted; that cascades to profiles
  // and credit_ledger. Refuses to delete if the cancel fails.
  if (body.action === 'delete_account') {
    if (body.confirm !== 'DELETE') return json({ error: 'confirm_required' }, 400);
    const subId = profile?.razorpay_subscription_id;
    if (subId) {
      const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${subId}`, { headers: { authorization: razorpayAuth() } });
      const sub = res.ok ? await res.json() : null;
      if (sub && cancellableStatus(sub.status)) {
        const cancel = await fetch(`https://api.razorpay.com/v1/subscriptions/${subId}/cancel`, {
          method: 'POST',
          headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
          body: JSON.stringify({ cancel_at_cycle_end: 0 }),
        });
        if (!cancel.ok) { console.error('delete: razorpay cancel failed', await cancel.text()); return json({ error: 'razorpay_error' }, 502); }
      } else if (!res.ok && res.status !== 404) {
        console.error('delete: razorpay lookup failed', res.status);
        return json({ error: 'razorpay_error' }, 502);
      }
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) { console.error('delete: deleteUser failed', error.message); return json({ error: 'server_error' }, 500); }
    console.log('account deleted', user.id);
    return json({ ok: true });
  }

  const { data: ent } = await userClient.rpc('ensure_grants');
  const isPro = !!ent?.pro; // admins are pro too, so they never reach checkout

  if (body.action === 'create') {
    if (isPro) return json({ error: 'already_pro' }, 409);
    const interval = body.interval === 'year' ? 'year' : 'month';
    const planId = planIdFor(body.currency, {
      usd: Deno.env.get('RAZORPAY_PLAN_USD')!, inr: Deno.env.get('RAZORPAY_PLAN_INR')!,
      usdYear: Deno.env.get('RAZORPAY_PLAN_USD_YEARLY'), inrYear: Deno.env.get('RAZORPAY_PLAN_INR_YEARLY'),
    }, interval);
    if (!planId) return json({ error: 'plan_unavailable' }, 400);
    const existing = profile?.razorpay_subscription_id;
    if (existing) {
      const prev = await fetch(`https://api.razorpay.com/v1/subscriptions/${existing}`, { headers: { authorization: razorpayAuth() } });
      const reuse = reusableSubscriptionId(prev.ok ? await prev.json() : null, planId);
      if (reuse) return json({ subscription_id: reuse, key_id: Deno.env.get('RAZORPAY_KEY_ID') });
    }
    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
      body: JSON.stringify({ plan_id: planId, total_count: interval === 'year' ? 10 : 120, customer_notify: 1, notes: { user_id: user.id } }),
    });
    const sub = await res.json();
    if (!res.ok) { console.error('razorpay create failed', sub); return json({ error: 'razorpay_error' }, 502); }
    await admin.from('profiles').update({ razorpay_subscription_id: sub.id }).eq('user_id', user.id);
    return json({ subscription_id: sub.id, key_id: Deno.env.get('RAZORPAY_KEY_ID') });
  }

  if (body.action === 'cancel') {
    const subId = profile?.razorpay_subscription_id;
    if (!subId) return json({ error: 'no_subscription' }, 404);
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${subId}/cancel`, {
      method: 'POST',
      headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
    });
    if (!res.ok) { console.error('razorpay cancel failed', await res.text()); return json({ error: 'razorpay_error' }, 502); }
    return json({ ok: true }); // pro stays until the webhook ends it at cycle end
  }

  return json({ error: 'unknown_action' }, 400);
});
