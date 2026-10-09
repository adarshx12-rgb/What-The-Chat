import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { packGrantForEvent, profileUpdateForEvent, verifySignature } from '../_shared/razorpay.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const raw = await req.text();
  const ok = await verifySignature(raw, req.headers.get('x-razorpay-signature') ?? '', Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '');
  if (!ok) return new Response(JSON.stringify({ error: 'bad signature' }), { status: 400 });

  let event: unknown;
  try { event = JSON.parse(raw); } catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 }); }

  const pack = packGrantForEvent(event);
  if (pack) {
    const { error } = await admin.rpc('grant_credit_pack', {
      p_order_id: pack.orderId, p_user: pack.userId, p_credits: pack.credits,
    });
    if (error) {
      console.error('credit pack grant failed', error.message);
      return new Response(JSON.stringify({ error: 'grant failed' }), { status: 500 }); // Razorpay retries
    }
  }

  const change = profileUpdateForEvent(event, Date.now());
  if (change) {
    const { error } = await admin.from('profiles')
      .update({ ...change.update, updated_at: new Date().toISOString() })
      .eq('user_id', change.userId);
    if (error) {
      console.error('profile update failed', error.message);
      return new Response(JSON.stringify({ error: 'update failed' }), { status: 500 }); // Razorpay retries
    }
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
});
