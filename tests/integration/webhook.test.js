const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..', '..');
const env = Object.fromEntries(execSync('npx supabase status -o env', { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const URL_ = env.API_URL + '/functions/v1/razorpay-webhook';
const SECRET = 'whsec_local_test';

function sign(body){ return crypto.createHmac('sha256', SECRET).update(body).digest('hex'); }
function post(body, signature){
  return fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature }, body });
}

test('webhook: signed activation makes the user pro; bad signature changes nothing; repeats are idempotent', async () => {
  const { data: created, error } = await admin.auth.admin.createUser({ email: `wh-${Date.now()}@example.com`, email_confirm: true });
  assert.ifError(error);
  const userId = created.user.id;
  const subId = 'sub_it_' + Date.now();
  const body = JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: {
    id: subId, status: 'active', current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: { user_id: userId },
  } } } });

  const forged = await post(body, 'deadbeef');
  assert.equal(forged.status, 400);
  let { data: p } = await admin.from('profiles').select('plan').eq('user_id', userId).single();
  assert.equal(p.plan, 'free');

  for (let i = 0; i < 2; i++) assert.equal((await post(body, sign(body))).status, 200);
  ({ data: p } = await admin.from('profiles').select('plan, pro_until, razorpay_subscription_id').eq('user_id', userId).single());
  assert.equal(p.plan, 'pro');
  assert.equal(p.razorpay_subscription_id, subId);
  assert.ok(new Date(p.pro_until) > new Date(Date.now() + 29 * 86400_000));

  const cancel = body.replace('subscription.activated', 'subscription.cancelled');
  assert.equal((await post(cancel, sign(cancel))).status, 200);
  ({ data: p } = await admin.from('profiles').select('plan').eq('user_id', userId).single());
  assert.equal(p.plan, 'free');
});

test('billing: visitors must sign in first, and admins never reach checkout', async () => {
  const { createClient: cc } = require('@supabase/supabase-js');
  const billing = (token) => fetch(env.API_URL + '/functions/v1/billing', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, apikey: env.ANON_KEY },
    body: JSON.stringify({ action: 'create', currency: 'USD' }),
  });

  const visitor = cc(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  const { data: anon, error: anonErr } = await visitor.auth.signInAnonymously();
  assert.ifError(anonErr);
  assert.equal((await billing(anon.session.access_token)).status, 403);

  const email = `admin-${Date.now()}@example.com`;
  const { error } = await admin.auth.admin.createUser({ email, password: 'pw-123456!', email_confirm: true });
  assert.ifError(error);
  execSync(`docker exec supabase_db_whatsapp-chat-recorder psql -U postgres -c "insert into private.admin_emails (email) values ('${email}')"`);
  const owner = cc(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  const { data: signed, error: signErr } = await owner.auth.signInWithPassword({ email, password: 'pw-123456!' });
  assert.ifError(signErr);
  const res = await billing(signed.session.access_token);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'already_pro' });
});
