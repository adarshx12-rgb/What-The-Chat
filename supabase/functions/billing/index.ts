import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { planIdFor } from '../_shared/razorpay.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

function razorpayAuth() {
  return 'Basic ' + btoa(`${Deno.env.get('RAZORPAY_KEY_ID')}:${Deno.env.get('RAZORPAY_KEY_SECRET')}`);
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'not_signed_in' }, 401);
  if (user.is_anonymous) return json({ error: 'sign_in_required' }, 403);

  const body = await req.json().catch(() => ({}));
  const { data: profile } = await admin.from('profiles').select('*').eq('user_id', user.id).single();
  const { data: ent } = await userClient.rpc('ensure_grants');
  const isPro = !!ent?.pro; // admins are pro too, so they never reach checkout

  if (body.action === 'create') {
    if (isPro) return json({ error: 'already_pro' }, 409);
    const planId = planIdFor(body.currency, {
      usd: Deno.env.get('RAZORPAY_PLAN_USD')!, inr: Deno.env.get('RAZORPAY_PLAN_INR')!,
    });
    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
      body: JSON.stringify({ plan_id: planId, total_count: 120, customer_notify: 1, notes: { user_id: user.id } }),
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
