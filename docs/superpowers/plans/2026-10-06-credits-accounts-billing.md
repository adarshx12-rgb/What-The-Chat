# Credits, Accounts & Pro Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a credit system (visitor → signed-in free → Pro $8/mo) to the studio. Supabase tracks credits server-side, and exports get a canvas-drawn watermark once credits run out.

**Architecture:**
- **Recording stays 100% in the browser** (canvas → `MediaRecorder`, unchanged).
- **Supabase holds the balance.** Every visitor gets a Supabase *anonymous* session. Two `security definer` Postgres RPCs (`ensure_grants`, `spend_credits`) grant and spend credits atomically, and RLS blocks clients from writing balances directly.
- **The studio draws the watermark onto the same preview canvas**, so it lands in recordings and screenshots with no separate render path (spec #9).
- **Razorpay Subscriptions handle Pro.** A `billing` Edge Function creates/cancels subscriptions, and a `razorpay-webhook` Edge Function (HMAC-verified) flips `plan`/`pro_until`.

**Tech Stack:**
- Supabase: Postgres + RLS + pgTAP, Auth (anonymous, Google, email magic link), Edge Functions on Deno.
- `@supabase/supabase-js@2.117.2` UMD from jsdelivr (pinned).
- Razorpay Subscriptions + Checkout.js.
- Tests: `node:test`, Playwright 1.63 driving system Edge (`channel:'msedge'`), Deno via `npx deno`.
- Supabase CLI via `npx supabase` (2.119.0 present), with Docker for the local stack.

**Spec:** The design was agreed in chat on 2026-10-06; this summary is the source of truth.

| Rule | Value |
|---|---|
| Screenshot cost | 1 credit |
| Video cost | 1 credit per started 3 seconds (30 s = 10 credits) |
| Visitor (anonymous) | 20 credits, one time |
| Signed-in free | +40 credits at first sign-in, then +40 every month (additive) |
| Pro | $8/month (USD plan) or ₹499/month (INR plan), unlimited, never watermarked |
| Visitor at 0 credits | Export is watermarked + prompt to sign in |
| Signed-in free at 0 credits | Export is watermarked + prompt to upgrade |
| Mid-recording run-out | Watermark appears from that moment on; charge = actual length, capped at balance |
| Admin | Verified email on `private.admin_emails` → `admin:true`, treated as Pro forever (never charged, never watermarked, billing refuses checkout). List filled by hand in the dashboard, never committed. |
| Login methods | Google + email magic link |
| Payments | Razorpay International (Subscriptions) |
| Support inbox | `support@whatthechat.com` via Cloudflare Email Routing (receive only) |
| Sign-in email sending | Custom SMTP (Resend) from `no-reply@whatthechat.com`; Cloudflare can't send |
| Supabase project | URL `https://qmlhbpwbhcdefwbixcrh.supabase.co`, anon key given in chat (public, safe to commit) |

## Global Constraints

- **Row Level Security is on for every table**, with no exceptions. User data is readable only by its owner (`user_id = auth.uid()`). Clients get no write policies; balance changes go only through `security definer` functions. Internal tables have RLS on with no policies (deny all). Any future table must ship with RLS + owner policies in the same migration.
- No build step. The site stays static HTML + plain `<script>` files. New npm tooling lives only in `tests/` (never deployed).
- Never use `getDisplayMedia`. Recording stays `canvas.captureStream(30)` + `MediaRecorder` (CLAUDE.md spec #10).
- **Preview = recording source** (spec #9): the watermark is drawn by `draw()` onto `previewCanvas`. It is never a DOM overlay, and there's no second render.
- The **service_role key and Razorpay secrets never appear in any file under the site root.** They live only in Supabase secrets and the local `tests/` env.
- The optional local MP4 backend (`server/`) and its fallback behavior stay untouched.
- The studio must still open and work as a plain `file://` page. With no Supabase reachable it runs in **offline mode**: 0 credits, exports watermarked, no errors thrown.
- External scripts are pinned exact versions, loaded only from `cdn.jsdelivr.net` or `checkout.razorpay.com`.
- Before adding any top-level function to `app/index.html`, grep for its name. Same-named function declarations silently overwrite each other (see the `formatDuration` incident in CLAUDE.md).
- Never call `scrollIntoView()` in the studio. Keep the global `[hidden]{display:none !important}` rule working for any new element that sets `display:`.
- Copy style: short, plain sentences. No `alert()`; use `showToast()` or inline text.
- Root `index.html` is CRLF. `app/index.html` and the policy pages are LF.

## Review Focus

1. **Offline / blocked network.** With Supabase unreachable (`file://`, CDN blocked, API down), the studio loads with zero page errors. The chip reads "Offline", and screenshots and recordings still export, watermarked. Test: Task 3 `offline mode` e2e.
2. **Running out mid-recording**, including across Pause/Resume. The watermark appears exactly when *recorded* time (pauses excluded) passes `credits × 3 s`, and the charge never exceeds the balance. Test: Task 5 `watermarks after credits run out`.
3. **Converting a visitor to a signed-in user keeps the same account.** Remaining visitor credits carry over and the +40 bonus is added exactly once. Test: Task 6 `magic link converts the visitor`.
4. **Every table has RLS, scoped to its owner.** The pgTAP guard fails if any table in `public`/`private` lacks RLS. That includes tables added in later migrations: add owner policies (or none, for internal tables) before the test will pass. Test: Task 1 `every table … has RLS enabled`.
5. **Client tampering.** A signed-in user calling `update profiles set credits=999` or inserting ledger rows through the REST API is rejected. Test: Task 1 pgTAP `permission denied` assertions.
6. **Duplicate or forged webhooks.** A bad signature returns 400 and changes nothing. A repeated `subscription.charged` is idempotent. Test: Task 7 webhook integration test.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/config.toml` | Local stack config (created by `supabase init`, edited) |
| `supabase/migrations/20261006120000_credits.sql` | Tables, RLS, trigger, `ensure_grants`, `spend_credits` |
| `supabase/seed.sql` | Local-only: lifts the per-IP visitor limit for e2e runs |
| `supabase/tests/credits.test.sql` | pgTAP tests for the migration |
| `supabase/functions/_shared/razorpay.ts` | Pure helpers: signature verify, event → profile update, plan pick |
| `supabase/functions/_shared/razorpay.test.ts` | Deno unit tests for the helpers |
| `supabase/functions/billing/index.ts` | Create / cancel a subscription for the signed-in user |
| `supabase/functions/razorpay-webhook/index.ts` | Verified webhook → profile update |
| `assets/credits-config.js` | Public config: Supabase URL + anon key + display prices |
| `assets/credits-core.js` | Pure credit math (browser global + CommonJS for node tests) |
| `assets/credits.js` | Supabase client, anonymous session, grants, spend, sign-in, billing calls |
| `app/index.html` | Watermark drawing, screenshot/recording gating, credits chip, account dialog |
| `refund-policy.html` | New policy page (needed for Razorpay activation) |
| `privacy-policy.html`, `terms-and-conditions.html`, `sitemap.xml`, footers | Policy updates |
| `tests/package.json`, `tests/playwright.config.js`, `tests/e2e/*.spec.js`, `tests/e2e/fixtures.js`, `tests/unit/*.test.js`, `tests/integration/*.test.js` | Test tooling (not deployed) |
| `DEPLOYMENT.md`, `CLAUDE.md`, `.gitignore` | Docs |

---

### Task 1: Supabase schema, credit RPCs and pgTAP tests

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`, then edit)
- Create: `supabase/migrations/20261006120000_credits.sql`
- Create: `supabase/seed.sql`
- Test: `supabase/tests/credits.test.sql`

**Interfaces:**
- Produces:
  - `public.ensure_grants() returns jsonb`
  - `public.spend_credits(p_kind text, p_amount integer) returns jsonb`
  - Both return `{credits:int, pro:bool, pro_until:timestamptz|null}`. `spend_credits` adds `{allowed:bool, charged:int, cost:int}`.
  - Table `public.profiles(user_id, credits, plan, pro_until, visitor_grant_done, signup_bonus_done, last_refill_at, razorpay_subscription_id, created_at, updated_at)`
  - Table `public.credit_ledger`
  - `private.app_settings` keys `ip_salt` and `visitor_ip_daily_limit`

- [ ] **Step 1: Initialise Supabase locally**

Run from the repo root:
```bash
npx supabase init
```
Expected: creates `supabase/config.toml` and `supabase/.gitignore`. Answer "N" to any VS Code / IntelliJ Deno settings prompts.

- [ ] **Step 2: Edit `supabase/config.toml`**

Set these keys. Each one already exists in the generated file, so edit it in place rather than duplicating the section:

```toml
[auth]
site_url = "http://127.0.0.1:8080/app/index.html"
additional_redirect_urls = ["http://127.0.0.1:8080/**", "http://localhost:8080/**", "https://whatthechat.com/**"]
enable_anonymous_sign_ins = true
enable_manual_linking = true

[auth.rate_limit]
email_sent = 100
anonymous_users = 1000

[auth.email]
enable_confirmations = true

[functions.razorpay-webhook]
verify_jwt = false
```

- [ ] **Step 3: Write the failing pgTAP test** `supabase/tests/credits.test.sql`

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- RLS guard: fails if ANY table in public/private (now or added later) lacks RLS.
select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname, ', '), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private') and not c.relrowsecurity),
  '', 'every table in public and private has RLS enabled');
select policies_are('public', 'profiles', array['profiles: owner can read own row'], 'profiles has only the owner-read policy');
select policies_are('public', 'credit_ledger', array['credit_ledger: owner can read own rows'], 'credit_ledger has only the owner-read policy');

-- Production per-IP limit for this test, regardless of seed.sql.
update private.app_settings set value = '3' where key = 'visitor_ip_daily_limit';

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', null),
  ('22222222-2222-2222-2222-222222222222', 'free@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'pro@example.com'),
  ('44444444-4444-4444-4444-444444444444', null),
  ('55555555-5555-5555-5555-555555555555', null),
  ('66666666-6666-6666-6666-666666666666', null);

select is((select count(*)::int from public.profiles where user_id::text like '%1111' or user_id::text like '%2222' or user_id::text like '%3333'),
          3, 'trigger creates a profile per auth user');

update public.profiles set plan = 'pro', pro_until = now() + interval '10 days'
 where user_id = '33333333-3333-3333-3333-333333333333';

-- Public anon key (no session) sees and writes nothing ----------------------
set local role anon;
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'anon key cannot read profiles');
select throws_ok($$ select count(*) from private.app_settings $$, '42501', null, 'anon key cannot read internal settings');
reset role;

-- Visitor (anonymous) ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","is_anonymous":true}', true);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}', true);

select is((public.ensure_grants()->>'credits')::int, 20, 'visitor gets 20 credits');
select is((public.ensure_grants()->>'credits')::int, 20, 'visitor grant is one-time');
select is((public.spend_credits('video', 31)->>'charged')::int, 11, '31 s of video costs 11 credits');
select is((public.spend_credits('video', 600)->>'charged')::int, 9, 'video charge is capped at the balance');
select is((public.spend_credits('screenshot', 1)->>'allowed')::boolean, false, 'screenshot refused at 0 credits');
select is((public.spend_credits('screenshot', 1)->>'credits')::int, 0, 'balance never goes negative');
select throws_ok($$ select public.spend_credits('gif', 1) $$, '22023', null, 'unknown kind rejected');
select throws_ok($$ select public.spend_credits('video', -5) $$, '22023', null, 'negative amount rejected');
select throws_ok($$ update public.profiles set credits = 999 $$, '42501', null, 'clients cannot write balances');
select throws_ok($$ insert into public.credit_ledger(user_id, delta, reason) values ('11111111-1111-1111-1111-111111111111', 100, 'video') $$,
                 '42501', null, 'clients cannot write the ledger');
select is((select count(*)::int from public.profiles), 1, 'RLS: a user only sees their own profile');
select is((select count(*)::int from public.credit_ledger where user_id <> '11111111-1111-1111-1111-111111111111'), 0, 'RLS: a user never sees other users'' ledger rows');

-- Signed-in free ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","is_anonymous":false}', true);
select is((public.ensure_grants()->>'credits')::int, 40, 'sign-up bonus is 40');
select is((public.spend_credits('screenshot', 1)->>'credits')::int, 39, 'a screenshot costs 1 credit');
reset role;
update public.profiles set last_refill_at = now() - interval '32 days'
 where user_id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
select is((public.ensure_grants()->>'credits')::int, 79, 'monthly refill adds 40');
select is((public.ensure_grants()->>'credits')::int, 79, 'refill happens once per month');

-- Pro -----------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","is_anonymous":false}', true);
select is((public.spend_credits('video', 600)->>'charged')::int, 0, 'pro is never charged');

-- Per-IP visitor limit (3/day): user 1111 used one; 4444 and 5555 fit; 6666 does not.
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 20, 'second visitor from one IP gets credits');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 20, 'third visitor from one IP still gets credits');
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 0, 'fourth visitor from one IP on one day gets none');

select * from finish();
rollback;
```

- [ ] **Step 4: Start the stack and run the test to verify it fails**

```bash
npx supabase start
npx supabase test db
```
Expected: FAIL. `private.app_settings` / `public.ensure_grants` do not exist.

- [ ] **Step 5: Write the migration** `supabase/migrations/20261006120000_credits.sql`

```sql
-- Credits for What The Chat. Clients can only read their own rows; every
-- balance change goes through the security-definer functions below.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_settings (key text primary key, value text not null);
insert into private.app_settings (key, value) values
  ('ip_salt', encode(extensions.gen_random_bytes(16), 'hex')),
  ('visitor_ip_daily_limit', '3');

create table private.visitor_ip_grants (
  ip_hash text not null,
  day date not null,
  grants integer not null default 0,
  primary key (ip_hash, day)
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  plan text not null default 'free' check (plan in ('free', 'pro')),
  pro_until timestamptz,
  visitor_grant_done boolean not null default false,
  signup_bonus_done boolean not null default false,
  last_refill_at timestamptz,
  razorpay_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('visitor_grant', 'signup_bonus', 'monthly_refill', 'screenshot', 'video')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

-- Row Level Security on EVERY table, with no exceptions.
-- User tables: a signed-in user (including anonymous visitors, who use the
-- `authenticated` role) can SELECT only rows where user_id = their own id.
-- There are deliberately NO insert/update/delete policies: with RLS on and no
-- policy, those are denied. Owner-scoped write policies would let a user set
-- their own credits, so all writes go through the security-definer functions
-- below (which run as the table owner and are exempt from RLS).
-- Internal tables (private schema): RLS on with no policies = deny all to
-- every API role; only the security-definer functions touch them.
alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;
alter table private.app_settings enable row level security;
alter table private.visitor_ip_grants enable row level security;

create policy "profiles: owner can read own row" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "credit_ledger: owner can read own rows" on public.credit_ledger
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Belt and braces: the anon key role gets no table access at all, and signed-in
-- users only SELECT. (RLS would already block these; revoking makes the
-- intent explicit and fails loudly with 42501.)
revoke all on public.profiles, public.credit_ledger from anon;
revoke insert, update, delete, truncate on public.profiles, public.credit_ledger from authenticated;
revoke all on private.app_settings, private.visitor_ip_grants from anon, authenticated;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.entitlement_json(p public.profiles) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'credits', p.credits,
    'pro', p.plan = 'pro' and coalesce(p.pro_until > now(), false),
    'pro_until', p.pro_until);
$$;

create function private.grant_credits(p_user uuid, p_amount integer, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set credits = credits + p_amount, updated_at = now() where user_id = p_user;
  insert into public.credit_ledger (user_id, delta, reason) values (p_user, p_amount, p_reason);
end $$;

create function public.ensure_grants() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  p public.profiles;
  ip text;
  ip_key text;
  used integer;
  daily_limit integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.profiles (user_id) values (uid) on conflict do nothing;
  select * into p from public.profiles where user_id = uid for update;

  if is_anon and not p.visitor_grant_done then
    ip := trim(split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1));
    select encode(extensions.digest(coalesce(nullif(ip, ''), 'unknown') || s.value, 'sha256'), 'hex')
      into ip_key from private.app_settings s where s.key = 'ip_salt';
    select value::integer into daily_limit from private.app_settings where key = 'visitor_ip_daily_limit';
    insert into private.visitor_ip_grants as g (ip_hash, day, grants) values (ip_key, current_date, 1)
      on conflict (ip_hash, day) do update set grants = g.grants + 1
      returning g.grants into used;
    if used <= daily_limit then perform private.grant_credits(uid, 20, 'visitor_grant'); end if;
    update public.profiles set visitor_grant_done = true where user_id = uid;
  end if;

  if not is_anon and not p.signup_bonus_done then
    perform private.grant_credits(uid, 40, 'signup_bonus');
    update public.profiles set signup_bonus_done = true, last_refill_at = now() where user_id = uid;
  elsif not is_anon and p.last_refill_at < now() - interval '1 month' then
    perform private.grant_credits(uid, 40, 'monthly_refill');
    update public.profiles set last_refill_at = now() where user_id = uid;
  end if;

  select * into p from public.profiles where user_id = uid;
  return private.entitlement_json(p);
end $$;

create function public.spend_credits(p_kind text, p_amount integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p public.profiles;
  is_pro boolean;
  cost integer;
  charged integer := 0;
  allowed boolean;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_kind is null or p_kind not in ('screenshot', 'video') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 86400 then
    raise exception 'bad amount' using errcode = '22023';
  end if;
  select * into p from public.profiles where user_id = uid for update;
  if not found then raise exception 'no profile' using errcode = 'P0002'; end if;

  is_pro := p.plan = 'pro' and coalesce(p.pro_until > now(), false);
  cost := case when p_kind = 'screenshot' then 1 else ceil(p_amount / 3.0)::integer end;
  if is_pro then
    allowed := true;
  elsif p_kind = 'screenshot' then
    allowed := p.credits >= 1;
    charged := case when allowed then 1 else 0 end;
  else
    allowed := true;  -- the watermark was already decided while recording
    charged := least(cost, p.credits);
  end if;

  if charged > 0 then
    update public.profiles set credits = credits - charged, updated_at = now()
      where user_id = uid returning * into p;
    insert into public.credit_ledger (user_id, delta, reason, meta)
      values (uid, -charged, p_kind, jsonb_build_object('amount', p_amount, 'cost', cost));
  end if;
  return private.entitlement_json(p) || jsonb_build_object('allowed', allowed, 'charged', charged, 'cost', cost);
end $$;

revoke execute on function public.ensure_grants(), public.spend_credits(text, integer) from public, anon;
grant execute on function public.ensure_grants(), public.spend_credits(text, integer) to authenticated;
```

- [ ] **Step 6: Write `supabase/seed.sql`** (runs on local `db reset` only, never pushed)

```sql
-- Local e2e runs create many anonymous visitors from 127.0.0.1.
update private.app_settings set value = '1000' where key = 'visitor_ip_daily_limit';
```

- [ ] **Step 7: Apply and run the tests**

```bash
npx supabase db reset
npx supabase test db
```
Expected: `credits.test.sql .. ok`, `All tests successful.` (26 assertions).

> **As built (2026-10-06):** the committed migration/test add `private.admin_emails`, `private.is_admin(uuid)`, an `admin` key in every entitlement JSON, adopt Codex's `supabase/security/rls.sql` grants and policy names (`read own profile`, `read own ledger`), and the pgTAP plan is 31. The files in the repo are the source of truth over the SQL above.

- [ ] **Step 8: Commit**

```bash
git add supabase/config.toml supabase/.gitignore supabase/migrations supabase/seed.sql supabase/tests
git commit -m "feat(credits): schema, RLS and credit RPCs with pgTAP tests"
```

---

### Task 2: Pure credit math (`assets/credits-core.js`)

**Files:**
- Create: `assets/credits-core.js`
- Create: `tests/package.json`
- Test: `tests/unit/credits-core.test.js`

**Interfaces:**
- Produces: `window.WTCCreditsCore` (and `module.exports`) with:
  - `SECONDS_PER_CREDIT = 3`
  - `recordingSeconds(ms) -> int`
  - `videoCost(seconds) -> int`
  - `coveredMs(ent) -> number` (Infinity for Pro)
  - `watermarkActive(coveredMs, elapsedMs) -> bool`
  - `chipLabel(ent) -> string`
- The entitlement shape `ent` used everywhere: `{credits:number, pro:boolean, proUntil:string|null, isAnonymous:boolean, email:string|null, offline:boolean}` or `null` while loading.

- [ ] **Step 1: Create `tests/package.json`**

```json
{
  "name": "what-the-chat-tests",
  "private": true,
  "scripts": {
    "unit": "node --test unit/",
    "integration": "node --test integration/",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@supabase/supabase-js": "2.117.2",
    "http-server": "14.1.1",
    "pngjs": "7.0.0"
  }
}
```
Run `cd tests && npm install`. Expected: installs without errors. No browser download is needed, since tests use the installed Edge.

- [ ] **Step 2: Write the failing test** `tests/unit/credits-core.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../assets/credits-core.js');

test('video cost is 1 credit per started 3 seconds', () => {
  assert.equal(core.videoCost(0), 0);
  assert.equal(core.videoCost(1), 1);
  assert.equal(core.videoCost(3), 1);
  assert.equal(core.videoCost(4), 2);
  assert.equal(core.videoCost(30), 10);
  assert.equal(core.videoCost(600), 200);
});

test('recordingSeconds rounds up and ignores bad input', () => {
  assert.equal(core.recordingSeconds(0), 0);
  assert.equal(core.recordingSeconds(-50), 0);
  assert.equal(core.recordingSeconds(NaN), 0);
  assert.equal(core.recordingSeconds(1), 1);
  assert.equal(core.recordingSeconds(30000), 30);
  assert.equal(core.recordingSeconds(30001), 31);
});

test('coveredMs is credits x 3 s, infinite for pro, 0 when loading', () => {
  assert.equal(core.coveredMs({ credits: 20, pro: false }), 60000);
  assert.equal(core.coveredMs({ credits: 0, pro: false }), 0);
  assert.equal(core.coveredMs({ credits: 0, pro: true }), Infinity);
  assert.equal(core.coveredMs(null), 0);
});

test('watermark starts exactly when recorded time reaches coverage', () => {
  assert.equal(core.watermarkActive(6000, 5999), false);
  assert.equal(core.watermarkActive(6000, 6000), true);
  assert.equal(core.watermarkActive(0, 0), true);
  assert.equal(core.watermarkActive(Infinity, 1e9), false);
});

test('chip label', () => {
  assert.equal(core.chipLabel(null), 'Credits…');
  assert.equal(core.chipLabel({ credits: 0, pro: false, offline: true }), 'Offline');
  assert.equal(core.chipLabel({ credits: 1, pro: false }), '1 credit');
  assert.equal(core.chipLabel({ credits: 20, pro: false }), '20 credits');
  assert.equal(core.chipLabel({ credits: 0, pro: true }), 'Pro');
  assert.equal(core.chipLabel({ credits: 0, pro: true, admin: true }), 'Admin');
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd tests && npm run unit`
Expected: FAIL, `Cannot find module '../../assets/credits-core.js'`.

- [ ] **Step 4: Write `assets/credits-core.js`**

```js
/* What The Chat — credit math shared by the studio and the unit tests.
 * Must match public.spend_credits in supabase/migrations (1 credit per
 * started 3 seconds of video, 1 per screenshot). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WTCCreditsCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SECONDS_PER_CREDIT = 3;

  function recordingSeconds(ms){
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  function videoCost(seconds){
    return seconds > 0 ? Math.ceil(seconds / SECONDS_PER_CREDIT) : 0;
  }

  function coveredMs(ent){
    if (!ent) return 0;
    if (ent.pro) return Infinity;
    return Math.max(0, ent.credits | 0) * SECONDS_PER_CREDIT * 1000;
  }

  function watermarkActive(covered, elapsedMs){
    return elapsedMs >= covered;
  }

  function chipLabel(ent){
    if (!ent) return 'Credits…';
    if (ent.admin) return 'Admin';
    if (ent.pro) return 'Pro';
    if (ent.offline) return 'Offline';
    return ent.credits + (ent.credits === 1 ? ' credit' : ' credits');
  }

  return { SECONDS_PER_CREDIT, recordingSeconds, videoCost, coveredMs, watermarkActive, chipLabel };
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tests && npm run unit`
Expected: 5 tests pass.

- [ ] **Step 6: Ignore test deps and commit**

Append to `.gitignore`:
```
# Test tooling dependencies and reports
tests/node_modules/
tests/test-results/
tests/playwright-report/
```
```bash
git add .gitignore assets/credits-core.js tests/package.json tests/package-lock.json tests/unit
git commit -m "feat(credits): pure credit math with unit tests"
```

---

### Task 3: Credits client (`assets/credits.js`) + config + e2e harness

**Files:**
- Create: `assets/credits-config.js`
- Create: `assets/credits.js`
- Create: `tests/playwright.config.js`, `tests/e2e/fixtures.js`
- Modify: `app/index.html` (script tags before line 1131 `<script src="../assets/chat-emoji.js">`; boot call near line 5130 in the init block)
- Test: `tests/e2e/credits-client.spec.js`

**Interfaces:**
- Consumes: `WTCCreditsCore` (Task 2), RPCs `ensure_grants` / `spend_credits` (Task 1).
- Produces `window.WTCCredits`:
  - `ready(): Promise<ent>`, `refresh(): Promise<ent>`, `get(): ent|null`, `onChange(fn) -> unsubscribe`
  - `spendScreenshot(): Promise<{allowed:boolean, entitlement:ent}>`
  - `chargeVideo(ms): Promise<ent>`
  - `canSignIn(): boolean`, `userId(): Promise<string|null>`
  - `signInWithGoogle(): Promise<void>`, `sendMagicLink(email): Promise<void>`, `signOut(): Promise<ent>`
  - `client(): SupabaseClient|null` (used by Task 8)

- [ ] **Step 1: Write `tests/playwright.config.js`**

```js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 90000,
  workers: 1,
  use: {
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:8080',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx http-server .. -p 8080 -a 127.0.0.1 -c-1 --silent',
    url: 'http://127.0.0.1:8080/app/index.html',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: Write `tests/e2e/fixtures.js`**

```js
const { test: base, expect } = require('@playwright/test');
const { execSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const repoRoot = path.resolve(__dirname, '..', '..');

function readLocalSupabase(){
  const out = execSync('npx supabase status -o env', { cwd: repoRoot, encoding: 'utf8' });
  const env = {};
  for (const line of out.split(/\r?\n/)){
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return {
    url: env.API_URL,
    anonKey: env.ANON_KEY,
    serviceKey: env.SERVICE_ROLE_KEY,
    mailUrl: env.MAILPIT_URL || env.INBUCKET_URL || 'http://127.0.0.1:54324',
  };
}

const sb = readLocalSupabase();
const admin = createClient(sb.url, sb.serviceKey, { auth: { persistSession: false } });

const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/assets/credits-config.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.WTC_CONFIG = ' + JSON.stringify({
        supabaseUrl: sb.url, supabaseAnonKey: sb.anonKey, prices: { INR: '₹499', USD: '$8' },
      }) + ';',
    }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

async function openStudio(page){
  await page.goto('/app/index.html');
  return page.evaluate(() => WTCCredits.ready());
}

async function setProfile(page, fields){
  const id = await page.evaluate(() => WTCCredits.userId());
  const { error } = await admin.from('profiles').update(fields).eq('user_id', id);
  if (error) throw error;
  return page.evaluate(() => WTCCredits.refresh());
}

async function getProfile(page){
  const id = await page.evaluate(() => WTCCredits.userId());
  const { data, error } = await admin.from('profiles').select('*').eq('user_id', id).single();
  if (error) throw error;
  return data;
}

module.exports = { test, expect, admin, sb, openStudio, setProfile, getProfile };
```

- [ ] **Step 3: Write the failing e2e test** `tests/e2e/credits-client.spec.js`

```js
const { test, expect, openStudio, getProfile } = require('./fixtures');

test('a new visitor gets an anonymous session with 20 credits', async ({ page }) => {
  const ent = await openStudio(page);
  expect(ent).toMatchObject({ credits: 20, pro: false, isAnonymous: true, offline: false });
  expect((await getProfile(page)).visitor_grant_done).toBe(true);
});

test('reloading keeps the same visitor and does not re-grant', async ({ page }) => {
  await openStudio(page);
  const id = await page.evaluate(() => WTCCredits.userId());
  await page.reload();
  const ent = await page.evaluate(() => WTCCredits.ready());
  expect(await page.evaluate(() => WTCCredits.userId())).toBe(id);
  expect(ent.credits).toBe(20);
});

test('spendScreenshot and chargeVideo hit the server', async ({ page }) => {
  await openStudio(page);
  const shot = await page.evaluate(() => WTCCredits.spendScreenshot());
  expect(shot.allowed).toBe(true);
  expect(shot.entitlement.credits).toBe(19);
  const ent = await page.evaluate(() => WTCCredits.chargeVideo(30000));
  expect(ent.credits).toBe(9);
});

test('offline mode: no Supabase means 0 credits, no errors', async ({ page }) => {
  await page.route('**/auth/v1/**', (r) => r.abort());
  await page.route('**/rest/v1/**', (r) => r.abort());
  const ent = await openStudio(page);
  expect(ent).toMatchObject({ credits: 0, pro: false, offline: true });
  const shot = await page.evaluate(() => WTCCredits.spendScreenshot());
  expect(shot.allowed).toBe(false);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd tests && npx playwright test e2e/credits-client.spec.js`
Expected: FAIL, `WTCCredits is not defined`.

- [ ] **Step 5: Write `assets/credits-config.js`**

```js
/* Public Supabase settings. The anon key is designed to be public: Row Level
 * Security in supabase/migrations decides what it can do. Never put the
 * service_role key or Razorpay secrets in this file. */
window.WTC_CONFIG = {
  supabaseUrl: 'https://qmlhbpwbhcdefwbixcrh.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtbGhicHdiaGNkZWZ3Yml4Y3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjE0MDYsImV4cCI6MjEwNjc5NzQwNn0.Vn-Qk4-_wGJoqdGQ15SzHrG38uSxydEpbF7SEknG3RA',
  prices: { INR: '₹499', USD: '$8' },
};
```

- [ ] **Step 6: Write `assets/credits.js`**

```js
/* What The Chat — accounts and credits (Supabase).
 * Every visitor gets an anonymous Supabase session so credits live on the
 * server. If Supabase is unreachable or unconfigured, the studio runs in
 * offline mode: 0 credits, and exports are watermarked (fail closed). */
(function () {
  const core = window.WTCCreditsCore;
  const cfg = window.WTC_CONFIG || {};
  const OFFLINE = Object.freeze({ credits: 0, pro: false, admin: false, proUntil: null, isAnonymous: true, email: null, offline: true });
  const LINK_FLAG = 'wtc-google-link';
  const listeners = new Set();
  let sb = null;
  let entitlement = null;
  let readyPromise = null;

  function emit(){
    listeners.forEach((fn) => { try { fn(entitlement); } catch (e) { console.error(e); } });
  }

  function setEntitlement(next){
    entitlement = next;
    emit();
    return next;
  }

  async function sessionUser(){
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.user) || null;
  }

  async function fromRow(row){
    const user = await sessionUser();
    return {
      credits: row.credits | 0,
      pro: !!row.pro,
      admin: !!row.admin,
      proUntil: row.pro_until || null,
      isAnonymous: !user || !!user.is_anonymous,
      email: (user && user.email) || null,
      offline: false,
    };
  }

  async function syncGrants(){
    const { data, error } = await sb.rpc('ensure_grants');
    if (error) throw error;
    return setEntitlement(await fromRow(data));
  }

  async function startAnonymous(){
    const { error } = await sb.auth.signInAnonymously();
    if (error) throw error;
  }

  function redirectUrl(){ return location.origin + location.pathname; }

  function urlErrorCode(){
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    return query.get('error_code') || hash.get('error_code');
  }

  /* linkIdentity fails with identity_already_exists when the Google account
   * already belongs to another user (a returning user on a new device).
   * Then we sign in to that account normally; the visitor credits are left
   * behind, which is fine. */
  async function handleOAuthReturnError(){
    const code = urlErrorCode();
    if (!code) return;
    history.replaceState(null, '', location.pathname);
    let pendingLink = false;
    try { pendingLink = sessionStorage.getItem(LINK_FLAG) === '1'; sessionStorage.removeItem(LINK_FLAG); } catch (e) {}
    if (code === 'identity_already_exists' && pendingLink){
      await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } });
    }
  }

  async function boot(){
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return setEntitlement(OFFLINE);
    try {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      await handleOAuthReturnError();
      if (!(await sessionUser())) await startAnonymous();
      // Re-sync after sign-in/upgrade of the session. Deferred: awaiting other
      // Supabase calls inside this callback can deadlock the auth client.
      sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED'){
          setTimeout(() => { syncGrants().catch(() => {}); }, 0);
        }
      });
      return await syncGrants();
    } catch (e) {
      console.warn('[credits] offline mode:', e && e.message);
      return setEntitlement(OFFLINE);
    }
  }

  function ready(){ return readyPromise || (readyPromise = boot()); }

  async function refresh(){
    await ready();
    if (!sb || entitlement.offline) return entitlement;
    try { return await syncGrants(); } catch (e) { return entitlement; }
  }

  async function spend(kind, amount){
    const { data, error } = await sb.rpc('spend_credits', { p_kind: kind, p_amount: amount });
    if (error) throw error;
    setEntitlement(await fromRow(data));
    return data;
  }

  async function spendScreenshot(){
    await ready();
    if (!sb || entitlement.offline) return { allowed: false, entitlement };
    try {
      const data = await spend('screenshot', 1);
      return { allowed: !!data.allowed, entitlement };
    } catch (e) {
      return { allowed: false, entitlement };
    }
  }

  async function chargeVideo(ms){
    await ready();
    if (!sb || entitlement.offline) return entitlement;
    try { await spend('video', core.recordingSeconds(ms)); } catch (e) { console.warn('[credits] charge failed:', e && e.message); }
    return entitlement;
  }

  function canSignIn(){ return !!sb && /^https?:$/.test(location.protocol); }

  async function userId(){
    await ready();
    const user = await sessionUser();
    return user ? user.id : null;
  }

  function requireSignInAvailable(){
    if (!canSignIn()) throw new Error('Sign-in works on whatthechat.com, not on a local file.');
  }

  async function signInWithGoogle(){
    await ready();
    requireSignInAvailable();
    const user = await sessionUser();
    const options = { redirectTo: redirectUrl() };
    if (user && user.is_anonymous){
      try { sessionStorage.setItem(LINK_FLAG, '1'); } catch (e) {}
      const { error } = await sb.auth.linkIdentity({ provider: 'google', options });
      if (error) throw error;
      return;
    }
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options });
    if (error) throw error;
  }

  /* An anonymous visitor adds an email to the SAME account (credits carry
   * over). If that email already has an account, send a normal sign-in link. */
  async function sendMagicLink(email){
    await ready();
    requireSignInAvailable();
    const user = await sessionUser();
    if (user && user.is_anonymous){
      const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirectUrl() });
      if (!error) return;
      if (!/already|exists|registered/i.test(error.message || '')) throw error;
    }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } });
    if (error) throw error;
  }

  async function signOut(){
    await ready();
    if (!sb) return entitlement;
    await sb.auth.signOut();
    try { await startAnonymous(); return await syncGrants(); }
    catch (e) { return setEntitlement(OFFLINE); }
  }

  function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

  window.WTCCredits = {
    ready, refresh, get: () => entitlement, onChange,
    spendScreenshot, chargeVideo,
    canSignIn, userId, signInWithGoogle, sendMagicLink, signOut,
    client: () => sb,
  };
})();
```

- [ ] **Step 7: Load the scripts in `app/index.html`**

Insert directly **before** `<script src="../assets/chat-emoji.js"></script>` (line ~1131):

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js"></script>
<script src="../assets/credits-config.js"></script>
<script src="../assets/credits-core.js"></script>
<script src="../assets/credits.js"></script>
```

In the init block, directly before `renderMessageList();` (line ~5132), add:

```js
  WTCCredits.ready();
```

- [ ] **Step 8: Run the e2e tests**

```bash
npx supabase db reset
cd tests && npx playwright test e2e/credits-client.spec.js
```
Expected: 4 passed.

- [ ] **Step 9: Commit**

```bash
git add assets/credits-config.js assets/credits.js app/index.html tests/playwright.config.js tests/e2e
git commit -m "feat(credits): Supabase anonymous sessions and credit client"
```

---

### Task 4: Canvas watermark + screenshot gating

**Files:**
- Modify: `app/index.html`: add the watermark after `draw()` (line ~3229), edit `draw()`, replace `saveScreenshot()` (line ~3374)
- Test: `tests/e2e/watermark-screenshot.spec.js`

**Interfaces:**
- Consumes: `WTCCredits.spendScreenshot()`, `WTCCredits.get()`.
- Produces (top-level in `app/index.html`):
  - `const WATERMARK_BOX = {x, y, w, h}`
  - `let screenshotWatermark = false`
  - `function drawWatermark(ctx)`
  - `function exportWatermarkActive(now) -> boolean`. Task 5 extends this for recording.
  - `function promptAfterWatermark(kind)`. Task 6 replaces its action handler.

- [ ] **Step 1: Write the failing test** `tests/e2e/watermark-screenshot.spec.js`

```js
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { test, expect, openStudio, setProfile } = require('./fixtures');

async function saveShot(page){
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#screenshotBtn')]);
  return PNG.sync.read(fs.readFileSync(await download.path()));
}

function diffCounts(a, b, box){
  let inside = 0, outside = 0;
  for (let y = 0; y < a.height; y++){
    for (let x = 0; x < a.width; x++){
      const i = (y * a.width + x) * 4;
      const differs = Math.abs(a.data[i] - b.data[i]) > 8 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 8;
      if (!differs) continue;
      const inBox = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      if (inBox) inside++; else outside++;
    }
  }
  return { inside, outside };
}

test('a screenshot costs 1 credit and is clean; at 0 credits it is watermarked', async ({ page }) => {
  await openStudio(page);
  const clean = await saveShot(page);
  expect(clean.width).toBe(1080);
  expect(clean.height).toBe(1920);
  expect(await page.evaluate(() => WTCCredits.get().credits)).toBe(19);

  await setProfile(page, { credits: 0 });
  const marked = await saveShot(page);
  const box = await page.evaluate(() => WATERMARK_BOX);
  const { inside, outside } = diffCounts(clean, marked, box);
  expect(inside).toBeGreaterThan(5000);
  expect(outside).toBeLessThan(200);
  await expect(page.locator('#toastRegion')).toContainText('watermark');
});

test('the live preview is not watermarked outside exports', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 0 });
  expect(await page.evaluate(() => exportWatermarkActive(performance.now()))).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && npx playwright test e2e/watermark-screenshot.spec.js`
Expected: FAIL. The first screenshot leaves credits at 20, not 19.

- [ ] **Step 3: Add the watermark code** right after the closing `}` of `function draw(ctx, now)`

First run `grep -n "drawWatermark\|exportWatermarkActive\|WATERMARK_BOX\|promptAfterWatermark" app/index.html` and expect no matches.

```js
/* ---------------------------------------------------------------------
 * Export watermark — drawn onto the preview canvas itself, so recordings
 * and screenshots pick it up with no separate render path (spec #9).
 * Only shown while an export that isn't covered by credits is in progress.
 * ------------------------------------------------------------------- */
const WATERMARK_BOX = { x: 140, y: 1130, w: 800, h: 200 };
let screenshotWatermark = false;

function exportWatermarkActive(now){
  return screenshotWatermark;
}

function drawWatermark(ctx){
  const { x, y, w, h } = WATERMARK_BOX;
  ctx.save();
  ctx.fillStyle = 'rgba(9, 23, 46, 0.62)';
  roundRectPath(ctx, x, y, w, h, 36);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 58px ChatInter, "Segoe UI", sans-serif';
  ctx.fillText('Made with What The Chat', x + w / 2, y + 78);
  ctx.font = '500 40px ChatInter, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText('whatthechat.com', x + w / 2, y + 144);
  ctx.restore();
}

/* After a watermarked export: visitors are asked to sign in, signed-in
 * free users to upgrade. Task 6 wires the action to the account dialog. */
function promptAfterWatermark(kind){
  const ent = WTCCredits.get();
  const what = kind === 'video' ? 'Out of credits, so the rest of this video has a watermark.' : 'Out of credits, so this screenshot has a watermark.';
  if (ent && ent.offline) showToast(what + ' Credits need an internet connection.');
  else if (!ent || ent.isAnonymous) showToast(what + ' Sign in for 40 free credits.', 'Sign in', () => openAccountDialog());
  else showToast(what, 'Upgrade', () => openAccountDialog());
}
```

`roundRectPath(ctx, x, y, w, h, r)` already exists (line ~1439). It builds the path only, so call `ctx.fill()` after it, as above. `openAccountDialog` is created in Task 6. Until then, add this temporary stub directly below `promptAfterWatermark` so the action buttons don't throw. Task 6 deletes it:

```js
function openAccountDialog(){}
```

- [ ] **Step 4: Paint it at the end of `draw()`**

At the end of `draw(ctx, now)`, after the `if (tokens.glass){…} else {…}` block and before the closing `}`, add:

```js
  if (exportWatermarkActive(now)) drawWatermark(ctx);
```

- [ ] **Step 5: Replace `saveScreenshot()`**

```js
async function saveScreenshot(){
  await window.chatEmojiReady;
  const verdict = await WTCCredits.spendScreenshot();
  screenshotWatermark = !verdict.allowed;
  draw(previewCtx, performance.now());
  // toBlob snapshots the bitmap synchronously, so the flag can drop at once.
  previewCanvas.toBlob((blob) => {
    if (!blob){ showToast('Screenshot failed — try again.'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(blob, `whatsapp-chat-${state.platform}-${stamp}.png`);
    if (verdict.allowed) showToast('Screenshot saved');
    else promptAfterWatermark('screenshot');
  }, 'image/png');
  screenshotWatermark = false;
}
```

- [ ] **Step 6: Run the tests**

Run: `cd tests && npx playwright test e2e/watermark-screenshot.spec.js e2e/credits-client.spec.js`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/index.html tests/e2e/watermark-screenshot.spec.js
git commit -m "feat(credits): canvas watermark and credit-gated screenshots"
```

---

### Task 5: Credit-gated recording

**Files:**
- Modify: `app/index.html`: `makeRecorder()` (~line 3426), `updateRecTimers()` (~line 3593), `exportWatermarkActive()` (from Task 4)
- Test: `tests/e2e/watermark-recording.spec.js`

**Interfaces:**
- Consumes: `WTCCredits.refresh()`, `WTCCredits.chargeVideo(ms)`, `WTCCreditsCore.coveredMs/watermarkActive`, `promptAfterWatermark('video')`.
- Produces:
  - `fullRecElapsedMs(now) -> number`: recorded ms, pauses excluded.
  - `fullRecorder.coveredMs` and `fullRecorder.watermarkStarted`.

- [ ] **Step 1: Write the failing test** `tests/e2e/watermark-recording.spec.js`

```js
const { test, expect, openStudio, setProfile, getProfile } = require('./fixtures');

const watermarkNow = (page) => page.evaluate(() => exportWatermarkActive(performance.now()));

async function stopAndDownload(page){
  const download = page.waitForEvent('download');
  await page.click('#fullStopBtn');
  await download;
}

test('watermarks after credits run out and charges at most the balance', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 2 }); // covers 6 s
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  await page.waitForTimeout(2000);
  expect(await watermarkNow(page)).toBe(false);

  // Pausing must not count toward coverage.
  await page.click('#fullPauseBtn');
  await page.waitForTimeout(5000);
  expect(await watermarkNow(page)).toBe(false);
  await page.click('#fullResumeBtn');

  await page.waitForTimeout(5000);
  expect(await watermarkNow(page)).toBe(true);
  await expect(page.locator('#fullRecHelper')).toContainText('watermark');
  await stopAndDownload(page);
  await expect.poll(async () => (await getProfile(page)).credits).toBe(0);
  await expect(page.locator('#toastRegion')).toContainText('watermark');
  expect(await watermarkNow(page)).toBe(false);
});

test('a covered recording charges 1 credit per started 3 s', async ({ page }) => {
  await openStudio(page);
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  await page.waitForTimeout(4000);
  expect(await watermarkNow(page)).toBe(false);
  await stopAndDownload(page);
  await expect.poll(async () => (await getProfile(page)).credits).toBe(18);
});

test('pro records unlimited with no watermark and no charge', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 0, plan: 'pro', pro_until: new Date(Date.now() + 864e5).toISOString() });
  await page.click('#fullStartBtn');
  await page.waitForTimeout(2000);
  expect(await watermarkNow(page)).toBe(false);
  await stopAndDownload(page);
  expect((await getProfile(page)).credits).toBe(0);
});

test('zero credits watermarks from the first frame', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 0 });
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  expect(await watermarkNow(page)).toBe(true);
  await stopAndDownload(page);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && npx playwright test e2e/watermark-recording.spec.js`
Expected: FAIL. The watermark is never active during recording.

- [ ] **Step 3: Add `fullRecElapsedMs` and use it in `updateRecTimers`**

Grep first: `grep -n "fullRecElapsedMs" app/index.html` (expect none). Replace `updateRecTimers` with:

```js
function fullRecElapsedMs(now){
  const ctrl = fullRecorder;
  if (ctrl.state === 'recording') return now - ctrl.recStartWall - ctrl.recPausedAccum;
  if (ctrl.state === 'paused') return ctrl.recPauseStart - ctrl.recStartWall - ctrl.recPausedAccum;
  return ctrl.recEndWall - ctrl.recStartWall - ctrl.recPausedAccum;
}

function updateRecTimers(now){
  const ctrl = fullRecorder;
  const el = $(ctrl.kind + 'RecTimer');
  if (ctrl.state === 'idle' || ctrl.state === 'error'){ el.textContent = '00:00'; return; }
  el.textContent = formatDuration(fullRecElapsedMs(now));
  if (ctrl.state === 'recording' && !ctrl.watermarkStarted
      && WTCCreditsCore.watermarkActive(ctrl.coveredMs, fullRecElapsedMs(now))){
    ctrl.watermarkStarted = true;
    $(ctrl.kind + 'RecHelper').textContent = 'Out of credits. The rest gets a watermark.';
  }
}
```

- [ ] **Step 4: Extend `exportWatermarkActive`** (replace the Task 4 version)

```js
function exportWatermarkActive(now){
  if (screenshotWatermark) return true;
  const s = fullRecorder.state;
  if (s !== 'recording' && s !== 'paused') return false;
  return WTCCreditsCore.watermarkActive(fullRecorder.coveredMs, fullRecElapsedMs(now));
}
```

- [ ] **Step 5: Wire credits into `makeRecorder`**

5a. Add two fields to the `ctrl` object literal:

```js
    coveredMs: Infinity, watermarkStarted: false,
```

5b. In `ctrl.start`, after the `await window.chatEmojiReady;` line and its re-entry guard, insert:

```js
    const ent = await WTCCredits.refresh();
    if (ctrl.state === 'recording' || ctrl.state === 'paused' || ctrl.state === 'processing') return;
    ctrl.coveredMs = WTCCreditsCore.coveredMs(ent);
    ctrl.watermarkStarted = false;
```

5c. In the `recording` branch of `setButtons()`, show the coverage:

```js
    else if (s === 'recording') helper.textContent = ctrl.watermarkStarted
      ? 'Out of credits. The rest gets a watermark.'
      : (ctrl.coveredMs === Infinity ? 'Recording preview.' : 'Recording. Credits cover ' + formatDuration(ctrl.coveredMs) + '.');
```

5d. In `ctrl.mediaRecorder.onstop`, directly after `ctrl.recEndWall = performance.now();`, insert:

```js
      const recordedMs = ctrl.recEndWall - ctrl.recStartWall - ctrl.recPausedAccum;
      WTCCredits.chargeVideo(Math.min(recordedMs, ctrl.coveredMs));
      if (ctrl.watermarkStarted || ctrl.coveredMs === 0) promptAfterWatermark('video');
```

The charge is capped at `coveredMs`, so a watermarked tail is never billed. The server also caps the charge at the balance.

- [ ] **Step 6: Run the tests**

Run: `cd tests && npx playwright test`
Expected: all specs pass (credits-client, watermark-screenshot, watermark-recording).

- [ ] **Step 7: Commit**

```bash
git add app/index.html tests/e2e/watermark-recording.spec.js
git commit -m "feat(credits): watermark recordings once credits run out, charge on stop"
```

---

### Task 6: Credits chip + sign-in dialog

**Files:**
- Modify: `app/index.html`. Markup goes in the header (line ~820, before `#studioThemeBtn`), plus a `<dialog>` directly after `</header>`. CSS goes at the end of the `STUDIO THEME` block in the first `<style>`. JS: a `wireAccountUI()` call in the init block, and delete the Task 4 stub `openAccountDialog`.
- Test: `tests/e2e/account.spec.js`

**Interfaces:**
- Consumes: `WTCCredits.onChange/get/canSignIn/signInWithGoogle/sendMagicLink/signOut`, `WTCCreditsCore.chipLabel`.
- Produces: `openAccountDialog()`, `renderAccount(ent)`, `wireAccountUI()`. Element ids: `creditsChip`, `creditsChipText`, `accountDialog`, `accountBalance`, `signInSection`, `signInFileNote`, `googleSignInBtn`, `magicLinkForm`, `magicLinkEmail`, `signInStatus`, `accountSection`, `accountEmail`, `planSlot`, `signOutBtn`, `accountCloseBtn`.

- [ ] **Step 1: Write the failing test** `tests/e2e/account.spec.js`

```js
const { test, expect, sb, openStudio, setProfile } = require('./fixtures');

async function latestMailLink(address){
  for (let i = 0; i < 30; i++){
    const res = await fetch(`${sb.mailUrl}/api/v1/search?query=${encodeURIComponent('to:' + address)}`);
    const { messages } = await res.json();
    if (messages && messages.length){
      const msg = await (await fetch(`${sb.mailUrl}/api/v1/message/${messages[0].ID}`)).json();
      const link = (msg.Text + ' ' + msg.HTML).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/);
      if (link) return link[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no sign-in email for ' + address);
}

test('chip shows the balance and opens the account dialog', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('#creditsChipText')).toHaveText('20 credits');
  await page.click('#creditsChip');
  await expect(page.locator('#accountDialog')).toBeVisible();
  await expect(page.locator('#signInSection')).toBeVisible();
  await expect(page.locator('#accountSection')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#accountDialog')).toBeHidden();
});

test('chip updates after spending', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 1 });
  await expect(page.locator('#creditsChipText')).toHaveText('1 credit');
});

test('magic link converts the visitor and adds the 40 bonus once', async ({ page }) => {
  await openStudio(page);
  const visitorId = await page.evaluate(() => WTCCredits.userId());
  await page.evaluate(() => WTCCredits.spendScreenshot()); // 19 left
  const email = `visitor-${Date.now()}@example.com`;
  await page.click('#creditsChip');
  await page.fill('#magicLinkEmail', email);
  await page.click('#magicLinkForm button[type=submit]');
  await expect(page.locator('#signInStatus')).toContainText('Check your email');

  await page.goto(await latestMailLink(email));
  await expect.poll(() => page.evaluate(() => WTCCredits.get() && WTCCredits.get().email)).toBe(email);
  expect(await page.evaluate(() => WTCCredits.userId())).toBe(visitorId);
  await expect(page.locator('#creditsChipText')).toHaveText('59 credits');
  await page.click('#creditsChip');
  await expect(page.locator('#accountSection')).toBeVisible();
  await expect(page.locator('#accountEmail')).toHaveText(email);
});

test('Google button links the identity to the visitor account', async ({ page }) => {
  let requested = '';
  await page.route('**/auth/v1/user/identities/authorize*', (route) => {
    requested = route.request().url();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'http://127.0.0.1:8080/app/index.html' }) });
  });
  await openStudio(page);
  await page.click('#creditsChip');
  await page.click('#googleSignInBtn');
  await expect.poll(() => requested).toContain('provider=google');
});

test('sign out starts a fresh visitor session', async ({ page }) => {
  await openStudio(page);
  const before = await page.evaluate(() => WTCCredits.userId());
  await page.evaluate(() => WTCCredits.signOut());
  expect(await page.evaluate(() => WTCCredits.userId())).not.toBe(before);
  await expect(page.locator('#creditsChipText')).toHaveText('20 credits');
});
```

If the local auth server converts the anonymous user without sending an email (some CLI versions skip confirmation on email-add), change the magic-link test to assert `#signInStatus` and the 59-credit chip directly, without `latestMailLink`. Production has confirmations on (Task 10), so the email path is the one that matters.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && npx playwright test e2e/account.spec.js`
Expected: FAIL, `#creditsChipText` not found.

- [ ] **Step 3: Add the header chip** (inside `.headerProject`, directly before `<button type="button" class="small" id="studioThemeBtn" …>`)

```html
      <button type="button" class="creditsChip" id="creditsChip" aria-haspopup="dialog" aria-controls="accountDialog">
        <span class="creditsDot" aria-hidden="true"></span><span id="creditsChipText">Credits…</span>
      </button>
```

- [ ] **Step 4: Add the dialog** (directly after `</header>`)

```html
  <dialog id="accountDialog" aria-labelledby="accountTitle">
    <div class="accountHead">
      <h2 id="accountTitle">Credits &amp; account</h2>
      <button type="button" class="small" id="accountCloseBtn" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>
      </button>
    </div>
    <p class="accountBalance" id="accountBalance"></p>
    <p class="helperText">1 screenshot = 1 credit. 3 seconds of video = 1 credit. With no credits left, exports get a watermark.</p>

    <section id="signInSection" class="accountBlock">
      <h3>Sign in for 40 free credits a month</h3>
      <p class="helperText" id="signInFileNote" hidden>Sign-in works on whatthechat.com, not when the studio is opened as a local file.</p>
      <button type="button" class="btnBlock" id="googleSignInBtn">Continue with Google</button>
      <form id="magicLinkForm" novalidate>
        <label for="magicLinkEmail">Email</label>
        <input type="email" id="magicLinkEmail" autocomplete="email" required placeholder="you@example.com">
        <button type="submit" class="btnBlock">Email me a sign-in link</button>
      </form>
      <p class="helperText" id="signInStatus" aria-live="polite"></p>
    </section>

    <section id="accountSection" class="accountBlock" hidden>
      <p class="accountEmail" id="accountEmail"></p>
      <div id="planSlot"></div>
      <button type="button" class="btnBlock" id="signOutBtn">Sign out</button>
    </section>
  </dialog>
```

- [ ] **Step 5: Add the CSS** (append at the end of the `STUDIO THEME` block)

```css
  .creditsChip{height:32px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;
    font:500 12px/1 var(--studio-mono);font-variant-numeric:tabular-nums;white-space:nowrap;}
  .creditsDot{width:8px;height:8px;border-radius:50%;background:var(--studio-accent);}
  .creditsChip[data-empty="true"] .creditsDot{background:#e5484d;}
  #accountDialog{width:min(420px, calc(100vw - 32px));padding:20px;border:1.5px solid var(--studio-shadow);
    background:var(--studio-bg);color:var(--studio-text);box-shadow:6px 6px 0 var(--studio-shadow);}
  #accountDialog::backdrop{background:rgba(9,23,46,.45);}
  .accountHead{display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .accountHead h2{margin:0;font-size:16px;}
  .accountBalance{margin:12px 0 0;font:600 20px/1.3 var(--studio-mono);font-variant-numeric:tabular-nums;}
  .accountBlock{margin-top:16px;padding-top:16px;border-top:1px solid var(--studio-border);display:flex;flex-direction:column;gap:10px;}
  .accountBlock h3{margin:0;font-size:14px;}
  #magicLinkForm{display:flex;flex-direction:column;gap:6px;}
  #magicLinkForm label{font-size:12px;color:var(--studio-text-secondary);}
  #magicLinkForm input{min-height:var(--touch-h);padding:0 10px;background:var(--studio-input);color:var(--studio-text);
    border:1px solid var(--studio-border-strong);}
  .accountEmail{margin:0;font-weight:600;overflow-wrap:anywhere;}
```

- [ ] **Step 6: Add the JS** (in the main script, near `wireStudioThemeToggle`)

First run `grep -n "function openAccountDialog\|function renderAccount\|function wireAccountUI" app/index.html` and expect only the Task 4 stub. **Delete the stub `function openAccountDialog(){}`**, then add:

```js
/* ---------------------------------------------------------------------
 * Credits chip + account dialog (sign in with Google or an email link).
 * ------------------------------------------------------------------- */
function openAccountDialog(){
  const dialog = $('accountDialog');
  if (!dialog.open) dialog.showModal();
  if (document.body.classList.contains('exportSheetOpen')) closeExportSheet();
}

function renderAccount(ent){
  $('creditsChipText').textContent = WTCCreditsCore.chipLabel(ent);
  $('creditsChip').dataset.empty = String(!!ent && !ent.pro && ent.credits === 0);
  if (!ent) return;
  $('accountBalance').textContent = ent.admin
    ? 'Admin. Unlimited exports, no payment.'
    : ent.pro
    ? 'Pro' + (ent.proUntil ? ' until ' + new Date(ent.proUntil).toLocaleDateString() : '')
    : WTCCreditsCore.chipLabel(ent);
  const signedIn = !ent.offline && !ent.isAnonymous;
  $('signInSection').hidden = signedIn;
  $('accountSection').hidden = !signedIn;
  $('accountEmail').textContent = ent.email || '';
  const canSignIn = WTCCredits.canSignIn();
  $('signInFileNote').hidden = canSignIn;
  $('googleSignInBtn').disabled = !canSignIn;
  $('magicLinkForm').querySelector('button[type=submit]').disabled = !canSignIn;
}

function wireAccountUI(){
  const dialog = $('accountDialog');
  $('creditsChip').addEventListener('click', openAccountDialog);
  $('accountCloseBtn').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  $('googleSignInBtn').addEventListener('click', async () => {
    $('signInStatus').textContent = 'Opening Google…';
    try { await WTCCredits.signInWithGoogle(); }
    catch (e) { $('signInStatus').textContent = e.message || 'Could not open Google sign-in.'; }
  });

  $('magicLinkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('magicLinkEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ $('signInStatus').textContent = 'Enter a valid email.'; return; }
    $('signInStatus').textContent = 'Sending…';
    try {
      await WTCCredits.sendMagicLink(email);
      $('signInStatus').textContent = 'Check your email for the sign-in link.';
    } catch (err) {
      $('signInStatus').textContent = err.message || 'Could not send the link. Try again.';
    }
  });

  $('signOutBtn').addEventListener('click', async () => {
    await WTCCredits.signOut();
    showToast('Signed out');
  });

  WTCCredits.onChange(renderAccount);
  renderAccount(WTCCredits.get());
}
```

`closeExportSheet()` (line ~4006) is the existing export-sheet close function; the dialog opens above it, and closing the sheet first keeps focus handling simple.

Call it in the init block, right after the `WTCCredits.ready();` line added in Task 3:

```js
  wireAccountUI();
```

- [ ] **Step 7: Run all e2e tests**

Run: `npx supabase db reset && cd tests && npx playwright test`
Expected: all pass, with zero page errors (the fixture asserts this).

- [ ] **Step 8: Check the layout at 390px and 1024px**

Take one Playwright screenshot at each width (header with chip, dialog open) into `output/`. Confirm the header doesn't overflow at 390px. If it does, hide `.creditsDot` and shorten the label below 480px with a media query; don't drop the chip.

- [ ] **Step 9: Commit**

```bash
git add app/index.html tests/e2e/account.spec.js
git commit -m "feat(credits): credits chip and sign-in dialog (Google, email link)"
```

---

### Task 7: Razorpay billing Edge Functions

**Files:**
- Create: `supabase/functions/_shared/razorpay.ts`
- Test: `supabase/functions/_shared/razorpay.test.ts`
- Create: `supabase/functions/billing/index.ts`
- Create: `supabase/functions/razorpay-webhook/index.ts`
- Create: `supabase/functions/.env.test` (local only, gitignored)
- Test: `tests/integration/webhook.test.js`

**Interfaces:**
- Produces:
  - `verifySignature(rawBody: string, signature: string, secret: string): Promise<boolean>`
  - `profileUpdateForEvent(event: unknown, nowMs: number): { userId: string; update: Record<string, unknown> } | null`
  - `planIdFor(currency: string, env: { usd: string; inr: string }): string`
  - HTTP `POST /functions/v1/billing`, body `{action:'create', currency:'INR'|'USD'}` → `{subscription_id, key_id}`
  - HTTP `POST /functions/v1/billing`, body `{action:'cancel'}` → `{ok:true}`
  - HTTP `POST /functions/v1/razorpay-webhook` (Razorpay-signed) → `{ok:true}` / 400
- Secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_USD`, `RAZORPAY_PLAN_INR`. Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically.

- [ ] **Step 1: Write the failing Deno test** `supabase/functions/_shared/razorpay.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx deno test supabase/functions/_shared/`
Expected: FAIL, module `./razorpay.ts` not found.

- [ ] **Step 3: Write `supabase/functions/_shared/razorpay.ts`**

```ts
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
```

- [ ] **Step 4: Run the Deno tests**

Run: `npx deno test supabase/functions/_shared/`
Expected: 6 passed.

- [ ] **Step 5: Write `supabase/functions/razorpay-webhook/index.ts`**

```ts
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { profileUpdateForEvent, verifySignature } from '../_shared/razorpay.ts';

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
```

- [ ] **Step 6: Write `supabase/functions/billing/index.ts`**

```ts
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
```

- [ ] **Step 7: Write the failing webhook integration test** `tests/integration/webhook.test.js`

```js
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
  const body = JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: {
    id: 'sub_it_1', status: 'active', current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: { user_id: userId },
  } } } });

  const forged = await post(body, 'deadbeef');
  assert.equal(forged.status, 400);
  let { data: p } = await admin.from('profiles').select('plan').eq('user_id', userId).single();
  assert.equal(p.plan, 'free');

  for (let i = 0; i < 2; i++) assert.equal((await post(body, sign(body))).status, 200);
  ({ data: p } = await admin.from('profiles').select('plan, pro_until, razorpay_subscription_id').eq('user_id', userId).single());
  assert.equal(p.plan, 'pro');
  assert.equal(p.razorpay_subscription_id, 'sub_it_1');
  assert.ok(new Date(p.pro_until) > new Date(Date.now() + 29 * 86400_000));

  const cancel = body.replace('subscription.activated', 'subscription.cancelled');
  assert.equal((await post(cancel, sign(cancel))).status, 200);
  ({ data: p } = await admin.from('profiles').select('plan').eq('user_id', userId).single());
  assert.equal(p.plan, 'free');
});
```

- [ ] **Step 8: Serve the functions locally and run the test**

Create `supabase/functions/.env.test`:
```
RAZORPAY_WEBHOOK_SECRET=whsec_local_test
RAZORPAY_KEY_ID=rzp_test_local
RAZORPAY_KEY_SECRET=local
RAZORPAY_PLAN_USD=plan_local_usd
RAZORPAY_PLAN_INR=plan_local_inr
```
Add `supabase/functions/.env*` to `.gitignore`. In one terminal (background):
```bash
npx supabase functions serve --env-file supabase/functions/.env.test
```
Then:
```bash
cd tests && npm run integration
```
Expected: 1 passed. Before the functions are served, it fails with a connection error. That is the "verify it fails" check.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared supabase/functions/billing supabase/functions/razorpay-webhook tests/integration .gitignore
git commit -m "feat(billing): Razorpay subscription and webhook Edge Functions"
```

---

### Task 8: Upgrade to Pro in the studio (Razorpay Checkout)

**Files:**
- Modify: `assets/credits.js`: add `startCheckout(currency)` and `cancelPlan()`
- Modify: `app/index.html`: plan markup inside `#planSlot`, CSS, and JS in `renderAccount` / `wireAccountUI`
- Test: `tests/e2e/billing.spec.js`

**Interfaces:**
- Consumes: the `billing` function (Task 7), `WTCCredits.client()`, `renderAccount` (Task 6).
- Produces:
  - `WTCCredits.startCheckout(currency): Promise<'paid'|'dismissed'>`
  - `WTCCredits.cancelPlan(): Promise<void>`
  - `defaultCurrency() -> 'INR'|'USD'`
  - Element ids: `planCard`, `currencyToggle`, `planPrice`, `upgradeBtn`, `billingStatus`, `proSection`, `proUntilText`, `cancelPlanBtn`

- [ ] **Step 1: Write the failing test** `tests/e2e/billing.spec.js`

```js
const { test, expect, openStudio, setProfile, admin } = require('./fixtures');

async function signedInStudio(page){
  await openStudio(page);
  const email = `buyer-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'pw-123456!', email_confirm: true });
  if (error) throw error;
  await page.evaluate(async ([e]) => {
    const sb = WTCCredits.client();
    await sb.auth.signOut();
    await sb.auth.signInWithPassword({ email: e, password: 'pw-123456!' });
    await WTCCredits.refresh();
  }, [email]);
  return data.user.id;
}

test('upgrade opens Razorpay checkout with the created subscription', async ({ page }) => {
  await page.route('**/functions/v1/billing', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ subscription_id: 'sub_e2e', key_id: 'rzp_test_e2e' }),
  }));
  await page.route('https://checkout.razorpay.com/v1/checkout.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.Razorpay = function (o) { window.__rzp = o; this.open = function () {}; this.on = function () {}; };',
  }));
  const userId = await signedInStudio(page);
  await page.click('#creditsChip');
  await expect(page.locator('#planCard')).toBeVisible();
  await page.click('#currencyToggle [data-currency="USD"]');
  await expect(page.locator('#planPrice')).toContainText('$8');
  await page.click('#upgradeBtn');
  await expect.poll(() => page.evaluate(() => window.__rzp && window.__rzp.subscription_id)).toBe('sub_e2e');

  // Webhook lands (simulated), then Checkout reports success.
  await admin.from('profiles').update({ plan: 'pro', pro_until: new Date(Date.now() + 30 * 864e5).toISOString() }).eq('user_id', userId);
  await page.evaluate(() => window.__rzp.handler({ razorpay_subscription_id: 'sub_e2e' }));
  await expect(page.locator('#creditsChipText')).toHaveText('Pro');
  await expect(page.locator('#proSection')).toBeVisible();
  await expect(page.locator('#planCard')).toBeHidden();
});

test('visitors see the sign-in section, not the plan card', async ({ page }) => {
  await openStudio(page);
  await page.click('#creditsChip');
  await expect(page.locator('#planCard')).toBeHidden();
  await expect(page.locator('#signInSection')).toBeVisible();
});

test('cancel asks for confirmation, then calls billing cancel', async ({ page }) => {
  let body = null;
  await page.route('**/functions/v1/billing', (route) => {
    body = route.request().postDataJSON();
    route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });
  await signedInStudio(page);
  await setProfile(page, { plan: 'pro', pro_until: new Date(Date.now() + 30 * 864e5).toISOString() });
  await page.click('#creditsChip');
  await page.click('#cancelPlanBtn');
  expect(body).toBeNull();
  await expect(page.locator('#cancelPlanBtn')).toHaveText('Confirm cancel');
  await page.click('#cancelPlanBtn');
  await expect.poll(() => body && body.action).toBe('cancel');
  await expect(page.locator('#billingStatus')).toContainText('stays active until');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tests && npx playwright test e2e/billing.spec.js`
Expected: FAIL, `#planCard` not found.

- [ ] **Step 3: Add billing calls to `assets/credits.js`** (above `function onChange`)

```js
  let checkoutScript = null;
  function loadCheckout(){
    if (window.Razorpay) return Promise.resolve();
    return checkoutScript || (checkoutScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = () => { checkoutScript = null; reject(new Error('Could not load Razorpay. Check your connection.')); };
      document.head.appendChild(s);
    }));
  }

  async function waitForPro(){
    for (let i = 0; i < 20; i++){
      const ent = await refresh();
      if (ent.pro) return ent;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return entitlement;
  }

  async function startCheckout(currency){
    await ready();
    if (!sb) throw new Error('Payments need an internet connection.');
    const { data, error } = await sb.functions.invoke('billing', { body: { action: 'create', currency } });
    if (error) throw new Error(error.message === 'already_pro' ? 'You already have Pro.' : 'Could not start checkout. Try again.');
    await loadCheckout();
    return new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: data.key_id,
        subscription_id: data.subscription_id,
        name: 'What The Chat',
        description: 'Pro, monthly',
        prefill: { email: (entitlement && entitlement.email) || '' },
        theme: { color: '#20BC59' },
        handler: async () => { await waitForPro(); resolve('paid'); },
        modal: { ondismiss: () => resolve('dismissed') },
      });
      rzp.open();
    });
  }

  async function cancelPlan(){
    await ready();
    const { error } = await sb.functions.invoke('billing', { body: { action: 'cancel' } });
    if (error) throw new Error('Could not cancel. Try again or contact us.');
  }
```

Add `startCheckout, cancelPlan,` to the `window.WTCCredits` object.

- [ ] **Step 4: Add the plan markup** inside `<div id="planSlot"></div>` (replace the empty div)

```html
      <div id="planSlot">
        <div class="planCard" id="planCard">
          <h3>Pro</h3>
          <p class="helperText">Unlimited videos and screenshots. No watermark.</p>
          <div class="seg" role="group" aria-label="Currency" id="currencyToggle">
            <button type="button" class="segbtn" data-currency="INR">₹ INR</button>
            <button type="button" class="segbtn" data-currency="USD">$ USD</button>
          </div>
          <p class="planPrice" id="planPrice"></p>
          <button type="button" class="btnPrimary btnBlock" id="upgradeBtn">Upgrade to Pro</button>
        </div>
        <div id="proSection" hidden>
          <p id="proUntilText"></p>
          <button type="button" class="btnBlock" id="cancelPlanBtn">Cancel plan</button>
        </div>
        <p class="helperText" id="billingStatus" aria-live="polite"></p>
      </div>
```

CSS (append next to the Task 6 rules):

```css
  .planCard{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--studio-border-strong);background:var(--studio-surface-raised);}
  .planCard h3{margin:0;font-size:14px;}
  .planPrice{margin:0;font:600 18px/1.2 var(--studio-mono);}
  .planPrice small{font-size:12px;font-weight:400;color:var(--studio-text-secondary);}
```

- [ ] **Step 5: Wire it in `app/index.html`**

Grep first for `defaultCurrency|billingCurrency|renderPlan`; expect none. Add near `renderAccount`:

```js
function defaultCurrency(){
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  return (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') ? 'INR' : 'USD';
}
let billingCurrency = defaultCurrency();

function renderPlan(ent){
  const prices = (window.WTC_CONFIG && window.WTC_CONFIG.prices) || { INR: '₹499', USD: '$8' };
  const signedIn = !!ent && !ent.offline && !ent.isAnonymous;
  $('planCard').hidden = !signedIn || ent.pro;
  $('proSection').hidden = !signedIn || !ent.pro || ent.admin;
  $('currencyToggle').querySelectorAll('.segbtn').forEach((b) => {
    const on = b.dataset.currency === billingCurrency;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('planPrice').innerHTML = prices[billingCurrency] + ' <small>/ month</small>';
  if (ent && ent.pro) $('proUntilText').textContent = ent.proUntil
    ? 'Pro is active until ' + new Date(ent.proUntil).toLocaleDateString() + '.'
    : 'Pro is active.';
}
```

At the end of `renderAccount(ent)`, before its closing `}`, add `renderPlan(ent);`. That function returns early when `!ent`, so also call `renderPlan(ent)` before that `return`.

In `wireAccountUI()`, before `WTCCredits.onChange(renderAccount);`, add:

```js
  $('currencyToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-currency]');
    if (!btn) return;
    billingCurrency = btn.dataset.currency;
    renderPlan(WTCCredits.get());
  });

  $('upgradeBtn').addEventListener('click', async () => {
    const btn = $('upgradeBtn');
    btn.disabled = true;
    $('billingStatus').textContent = 'Opening checkout…';
    try {
      const result = await WTCCredits.startCheckout(billingCurrency);
      $('billingStatus').textContent = result === 'paid'
        ? (WTCCredits.get().pro ? 'Welcome to Pro.' : 'Payment received. Pro turns on within a minute.')
        : '';
    } catch (err) {
      $('billingStatus').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  let cancelArmed = false;
  $('cancelPlanBtn').addEventListener('click', async () => {
    const btn = $('cancelPlanBtn');
    if (!cancelArmed){ cancelArmed = true; btn.textContent = 'Confirm cancel'; return; }
    btn.disabled = true;
    try {
      await WTCCredits.cancelPlan();
      const ent = WTCCredits.get();
      $('billingStatus').textContent = 'Cancelled. Pro stays active until '
        + (ent.proUntil ? new Date(ent.proUntil).toLocaleDateString() : 'the end of this billing period') + '.';
    } catch (err) {
      $('billingStatus').textContent = err.message;
    } finally {
      cancelArmed = false;
      btn.textContent = 'Cancel plan';
      btn.disabled = false;
    }
  });
```

- [ ] **Step 6: Run all tests**

```bash
npx supabase db reset
cd tests && npm run unit && npx playwright test
```
Expected: all pass. The integration test needs `functions serve` running (see Task 7).

- [ ] **Step 7: Commit**

```bash
git add assets/credits.js app/index.html tests/e2e/billing.spec.js
git commit -m "feat(billing): upgrade to Pro and cancel from the account dialog"
```

---

### Task 9: Policy pages for Razorpay activation

**Files:**
- Create: `refund-policy.html` (LF, same shell as `terms-and-conditions.html`)
- Modify: `privacy-policy.html`, `terms-and-conditions.html`, `sitemap.xml`
- Modify: footers in `about.html`, `contact.html`, `privacy-policy.html`, `terms-and-conditions.html`, `refund-policy.html`, root `index.html` (CRLF!), and `app/index.html` (`.studioInfoLinks`)
- Test: `tests/unit/site-links.test.js`

- [ ] **Step 1: Write the failing link test** `tests/unit/site-links.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('refund policy exists, is canonical and in the sitemap', () => {
  const html = read('refund-policy.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/whatthechat\.com\/refund-policy\.html">/);
  assert.match(html, /<h1>Refund &amp; cancellation policy<\/h1>/);
  assert.match(read('sitemap.xml'), /<loc>https:\/\/whatthechat\.com\/refund-policy\.html<\/loc>/);
});

test('every page links the refund policy', () => {
  for (const f of ['index.html', 'about.html', 'contact.html', 'privacy-policy.html', 'terms-and-conditions.html', 'refund-policy.html']){
    assert.match(read(f), /href="refund-policy\.html"/, f);
  }
  assert.match(read('app/index.html'), /href="\.\.\/refund-policy\.html"/);
});

test('privacy policy names the new processors', () => {
  const html = read('privacy-policy.html');
  assert.match(html, /Supabase/);
  assert.match(html, /Razorpay/);
});

test('contact page uses the real support address', () => {
  const html = read('contact.html');
  assert.doesNotMatch(html, /example\.com/);
  assert.match(html, /href="mailto:support@whatthechat\.com">support@whatthechat\.com<\/a>/);
});

test('no page ships the service role key', () => {
  for (const f of ['assets/credits-config.js', 'assets/credits.js', 'app/index.html']){
    assert.doesNotMatch(read(f), /service_role|SERVICE_ROLE/i, f);
  }
});
```

Run: `cd tests && npm run unit`. Expected: FAIL on the refund-policy tests.

- [ ] **Step 2: Create `refund-policy.html`**

Copy `terms-and-conditions.html` exactly, then change only these:
- `<title>`, `og:title`, `twitter:title` → `Refund &amp; Cancellation Policy | What The Chat`
- `description`, `og:description`, `twitter:description` → `How What The Chat Pro subscriptions renew, how to cancel, and when refunds are given for unused or duplicate charges.`
- canonical / `og:url` / JSON-LD `@id` and `url` → `https://whatthechat.com/refund-policy.html`; JSON-LD `name` → `Refund & Cancellation Policy | What The Chat`
- breadcrumb current page → `Refund &amp; cancellation`; eyebrow → `Billing`; `<h1>Refund &amp; cancellation policy</h1>`; intro → `This policy covers What The Chat Pro, the paid monthly plan.`
- side nav links → `#subscription` Subscriptions, `#cancel` Cancelling, `#refunds` Refunds, `#free` Free credits, `#delivery` Delivery, `#contact` Contact
- window-bar label → `What The Chat / Refund &amp; cancellation`
- document body sections:

```html
<section id="subscription"><h2>Subscriptions</h2><p>Pro costs $8 a month, or ₹499 a month when billed in Indian rupees. It renews automatically each month until you cancel. Payments are processed by Razorpay.</p></section>
<section id="cancel"><h2>Cancelling</h2><p>Cancel any time from the studio: open the credits menu, then choose Cancel plan. Pro stays active until the end of the period you have paid for, and you are not charged again.</p></section>
<section id="refunds"><h2>Refunds</h2><p>Payments for a period that has started are not refundable, because Pro is a digital service available immediately. We refund in full if you were charged twice for the same period, charged after cancelling, or could not use Pro because of a fault on our side that we could not fix. Ask within 14 days of the charge. Approved refunds go back to the original payment method within 5–7 business days.</p></section>
<section id="free"><h2>Free credits</h2><p>Free credits have no cash value and cannot be refunded or transferred.</p></section>
<section id="delivery"><h2>Delivery</h2><p>Pro is delivered online. It turns on in your account as soon as Razorpay confirms the payment, usually within a minute. Nothing is shipped.</p></section>
<section id="contact"><h2>Contact</h2><p>For billing questions or refund requests, use our <a href="contact.html">contact page</a> and include the email on your account.</p></section>
```

- [ ] **Step 3: Update `privacy-policy.html`**

Add a section after the existing data sections (keep the side-nav in sync with an `#accounts` link):

```html
<section id="accounts"><h2>Accounts, credits and payments</h2><p>To track free credits, the studio creates an anonymous account for each browser using Supabase, our database and sign-in provider. If you sign in, we store your email address and, for Google sign-in, your Google account ID. We keep a record of credits granted and used. To limit abuse of free credits, we store a salted one-way hash of your IP address for each day; it cannot be turned back into the address. Your chat scripts, photos and recordings stay in your browser and are not uploaded.</p><p>Pro payments are handled by Razorpay. We receive your subscription status and ID, never your card details. To delete your account and credit history, contact us using the email on your account.</p></section>
```

- [ ] **Step 4: Update `terms-and-conditions.html`**

Add a section (and side-nav link `#credits`):

```html
<section id="credits"><h2>Credits and Pro</h2><p>Exports use credits: 1 per screenshot and 1 per started 3 seconds of video. Visitors receive 20 free credits; signed-in accounts receive 40 when they first sign in and 40 each month after that. When credits run out, exports carry a What The Chat watermark. Pro removes the limit and the watermark while your subscription is active. Credits have no cash value. We may change free credit amounts for future grants. Billing, cancellation and refunds are covered by our <a href="refund-policy.html">refund &amp; cancellation policy</a>.</p></section>
```

- [ ] **Step 5: Add the refund link to every footer and the studio**

In each footer `<nav aria-label="Footer">`, add `<a href="refund-policy.html">Refunds</a>` directly after the Terms link. In root `index.html` (CRLF), add the same anchor next to the existing `terms-and-conditions.html` link (line ~904), matching its classes (`class="nav-link !text-sky"`). Preserve CRLF: edit with the Edit tool, or normalise→patch→restore as described in CLAUDE.md. In `app/index.html` `.studioInfoLinks`, add `<a href="../refund-policy.html">Refunds</a>` after Terms.

- [ ] **Step 5b: Replace the placeholder support address in `contact.html`**

The support inbox is `support@whatthechat.com`, delivered by Cloudflare Email Routing (Task 10). On line ~39, replace the HTML comment, the placeholder link and the "temporary placeholder" paragraph:

```html
<!-- Replace this placeholder with your public support address before launch. --><p><a class="button" href="mailto:support@example.com">support@example.com</a></p><p>This is a temporary placeholder address. Support by email will be available once our contact details are updated.</p>
```
with:
```html
<p><a class="button" href="mailto:support@whatthechat.com">support@whatthechat.com</a></p><p>We usually reply within two working days. For billing questions, include the email on your account.</p>
```
Then remove the "Contact details" placeholder paragraph from `DEPLOYMENT.md` (it says `contact.html` uses `support@example.com`).

- [ ] **Step 6: Update `sitemap.xml`**

Add after the terms entry:

```xml
  <url><loc>https://whatthechat.com/refund-policy.html</loc></url>
```

- [ ] **Step 7: Run tests and commit**

Run: `cd tests && npm run unit`. Expected: all pass. Then confirm root `index.html` still uses CRLF: `file index.html` → `with CRLF line terminators`.

```bash
git add refund-policy.html privacy-policy.html terms-and-conditions.html about.html contact.html index.html app/index.html sitemap.xml DEPLOYMENT.md tests/unit/site-links.test.js
git commit -m "docs(policy): refund policy; privacy and terms cover credits and Pro"
```

---

### Task 10: Production setup, deploy and docs

This task mixes commands with dashboard steps **only the creator can do** (accounts, secrets, KYC). Do the CLI steps yourself and hand the dashboard checklist to the creator verbatim.

**Files:**
- Modify: `DEPLOYMENT.md`, `CLAUDE.md`

- [ ] **Step 1: Link and push the database**

```bash
npx supabase login
npx supabase link --project-ref qmlhbpwbhcdefwbixcrh
npx supabase db push
```
Expected: `Applying migration 20261006120000_credits.sql... Finished`. `seed.sql` is **not** applied to production, so the per-IP limit stays 3.

- [ ] **Step 2: Supabase dashboard (creator)**

- **Authentication → Sign In / Providers:**
  - turn on **Allow anonymous sign-ins** and **Allow manual linking**;
  - turn **Confirm email** on.
- **Authentication → Providers → Google:**
  - In Google Cloud Console, create an OAuth client of type "Web application".
  - Authorized redirect URI: `https://qmlhbpwbhcdefwbixcrh.supabase.co/auth/v1/callback`.
  - Paste the Client ID and Secret into Supabase.
- **Authentication → URL Configuration:**
  - Site URL `https://whatthechat.com/app/`
  - Redirect URLs `https://whatthechat.com/**`, `http://127.0.0.1:8080/**`, `http://localhost:8080/**`
- **Authentication → Rate Limits:** keep the anonymous sign-in limit at 30/hour per IP.

- [ ] **Step 2b: Email — receiving with Cloudflare, sending with an SMTP provider (creator)**

Cloudflare Email Routing only **receives and forwards** mail. It cannot send, so Supabase's sign-in links need a separate sending service. Supabase's built-in mailer is for testing only: a few emails per hour, which would break magic-link sign-in at launch.

1. **Receiving (Cloudflare Email Routing).** This needs `whatthechat.com`'s DNS on Cloudflare.
   - Go to Email → Email Routing → enable it. Cloudflare adds its MX + SPF records itself.
   - Add a destination address (your personal inbox) and confirm it.
   - Create a custom address `support@whatthechat.com` → forward to that inbox.
   - Send a test mail to `support@whatthechat.com` and check it arrives.
2. **Sending (Resend; free tier is 3,000 emails/month and 100/day).**
   - Sign up, then Domains → add `whatthechat.com`. Use the subdomain option `send.whatthechat.com` if offered, so it doesn't clash with Cloudflare's root MX/SPF.
   - Add the shown DKIM/SPF/MX records in Cloudflare DNS as **DNS only** (grey cloud), then click Verify.
   - Do **not** add a second SPF record on the root domain. If Resend asks for root SPF, merge its `include:` into Cloudflare's existing `v=spf1 … ~all` record.
   - Create an API key.
3. **Supabase → Authentication → Emails → SMTP Settings:** enable custom SMTP with these values:
   - host `smtp.resend.com`, port `465`
   - user `resend`, password = the Resend API key
   - sender `no-reply@whatthechat.com`, sender name `What The Chat`
   - Then raise **Rate Limits → emails per hour** to 100.
4. **Supabase → Authentication → Emails → Templates:** set the Magic Link and Change Email subjects to "Your What The Chat sign-in link". The body keeps `{{ .ConfirmationURL }}`.
5. **Replies from Gmail** show your personal address, because Cloudflare can't send. That's fine to start with. To reply *as* `support@whatthechat.com`, add it in Gmail → Settings → Accounts → "Send mail as", using Resend's SMTP (same host and credentials as above).

- [ ] **Step 3: Razorpay dashboard (creator)**

1. **Account & Settings → International payments:** request activation. Razorpay reviews the website: privacy, terms, refund policy and contact pages. Use `support@whatthechat.com` (Task 9 Step 5b) as the support email on the Razorpay account too, and make sure Step 2b's forwarding works first, since Razorpay may email it.
2. **Subscriptions → Plans:** create two monthly plans: `Pro USD` $8 and `Pro INR` ₹499. Copy both plan IDs.
3. **Account & Settings → API Keys:** generate keys (start in Test mode).
4. **Account & Settings → Webhooks:** add `https://qmlhbpwbhcdefwbixcrh.supabase.co/functions/v1/razorpay-webhook`.
   - Pick a secret.
   - Events: `subscription.activated`, `subscription.charged`, `subscription.resumed`, `subscription.cancelled`, `subscription.completed`, `subscription.halted`.
5. Ask Razorpay support to confirm that **international cards work with Subscriptions** on this account.

- [ ] **Step 4: Secrets and function deploy**

```bash
npx supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=xxx RAZORPAY_PLAN_USD=plan_xxx RAZORPAY_PLAN_INR=plan_xxx
npx supabase functions deploy billing
npx supabase functions deploy razorpay-webhook --no-verify-jwt
```
Expected: both deploy. `curl -X POST https://qmlhbpwbhcdefwbixcrh.supabase.co/functions/v1/razorpay-webhook -d '{}'` → `400 {"error":"bad signature"}`.

- [ ] **Step 4b: Make the creator admin (creator, once)**

In Supabase → SQL Editor, run this with your own sign-in email in lowercase:
```sql
insert into private.admin_emails (email) values ('you@example.com');
```
Then sign in to the studio with that email (Google or email link). The chip reads **Admin**, and exports are never charged or watermarked. To remove admin: `delete from private.admin_emails where email = '…';`.

- [ ] **Step 5: Production smoke test (Test-mode keys)**

On the deployed site (or `npx http-server . -p 8080` with the real config):
- chip shows 20 credits;
- sign in with Google → 60 credits (20 + 40), same user ID as the visitor;
- in a private window, sign in with the email link → the email arrives from `no-reply@whatthechat.com` within a minute (not in spam);
- Upgrade → pay with a Razorpay test card → chip shows Pro within a minute;
- Cancel → "stays active until…".

Check the Supabase table editor for the `profiles` and `credit_ledger` rows. Then swap to Live keys with `supabase secrets set` and the live plan IDs.

- [ ] **Step 6: Update `DEPLOYMENT.md`**

Add a section:

```markdown
## Accounts, credits and billing (Supabase + Razorpay)

Publish `assets/credits-config.js`, `assets/credits-core.js` and `assets/credits.js`
with the site. Do not publish `supabase/` or `tests/`. The anon key in
`credits-config.js` is public by design; RLS in `supabase/migrations` protects
the data. The service_role key and Razorpay secrets live only in Supabase
secrets (`npx supabase secrets set`).

Database changes: add a migration in `supabase/migrations/`, test locally with
`npx supabase db reset && npx supabase test db`, then `npx supabase db push`.
Functions: `npx supabase functions deploy billing` and
`npx supabase functions deploy razorpay-webhook --no-verify-jwt`.

Tests: `cd tests && npm install`, then `npm run unit`, `npx playwright test`
(needs `npx supabase start`), and `npm run integration` (needs
`npx supabase functions serve --env-file supabase/functions/.env.test`).
```

Also add `refund-policy.html` to the list of published pages.

- [ ] **Step 7: Update `CLAUDE.md`**

Add a `## Credits, accounts and Pro (October 2026)` section that records:
- the credit rules table from this plan's Spec;
- the fail-closed offline mode (this **changes** the zero-setup `file://` promise: offline exports are watermarked);
- the watermark being canvas-drawn through `exportWatermarkActive()`/`drawWatermark()`, keeping spec #9/#10;
- enforcement being soft by design (client-side watermark, server-side balance) and why;
- the file map (`assets/credits*.js`, `supabase/`, `tests/`);
- the deploy commands.

In "Site structure", add `refund-policy.html` and the `assets/credits*.js` files.

- [ ] **Step 8: Commit**

```bash
git add DEPLOYMENT.md CLAUDE.md
git commit -m "docs: deployment and project notes for credits and billing"
```

---

## Out of scope (follow-ups)

- **In-browser H.264 MP4 via WebCodecs + `mp4-muxer`**, replacing the need for the local `server/` for real users. This is a separate plan.
- Cloudflare Turnstile CAPTCHA on anonymous sign-in, if credit farming shows up in `credit_ledger`.
- Credits/sign-in on the homepage (`index.html`). The studio is the only place exports happen.
- Hard (server-side) watermark enforcement. That would need server rendering, and it was rejected on cost.
