begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- RLS guard: fails if ANY table in public/private (now or added later) lacks RLS.
select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname, ', '), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private') and not c.relrowsecurity),
  '', 'every table in public and private has RLS enabled');
select policies_are('public', 'profiles', array['read own profile'], 'profiles has only the owner-read policy');
select policies_are('public', 'credit_ledger', array['read own ledger'], 'credit_ledger has only the owner-read policy');

-- Production per-IP limit for this test, regardless of seed.sql.
update private.app_settings set value = '3' where key = 'visitor_ip_daily_limit';

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', null),
  ('22222222-2222-2222-2222-222222222222', 'free@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'pro@example.com'),
  ('44444444-4444-4444-4444-444444444444', null),
  ('55555555-5555-5555-5555-555555555555', null),
  ('66666666-6666-6666-6666-666666666666', null);
insert into auth.users (id, email, email_confirmed_at) values
  ('77777777-7777-7777-7777-777777777777', 'owner@example.com', now()),
  ('88888888-8888-8888-8888-888888888888', 'unverified-owner@example.com', null);
insert into private.admin_emails (email) values ('owner@example.com'), ('unverified-owner@example.com');

select is((select count(*)::int from public.profiles where user_id::text like '%1111' or user_id::text like '%2222' or user_id::text like '%3333'),
          3, 'trigger creates a profile per auth user');

update public.profiles set plan = 'pro', pro_until = now() + interval '10 days'
 where user_id = '33333333-3333-3333-3333-333333333333';

-- Public anon key (no session) sees and writes nothing ----------------------
set local role anon;
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'anon key cannot read profiles');
select throws_ok($$ select count(*) from private.app_settings $$, '42501', null, 'anon key cannot read internal settings');
select throws_ok($$ select count(*) from private.admin_emails $$, '42501', null, 'anon key cannot read the admin list');
reset role;

-- Visitor (anonymous) ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","is_anonymous":true}', true);
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.1, 203.0.113.9"}', true);

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

-- Admin (verified email on private.admin_emails) ---------------------------
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated","is_anonymous":false}', true);
select is((public.ensure_grants()->>'admin')::boolean, true, 'verified listed email is admin');
select is((public.ensure_grants()->>'pro')::boolean, true, 'admin counts as pro');
select is((public.spend_credits('video', 600)->>'charged')::int, 0, 'admin is never charged');
select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated","is_anonymous":false}', true);
select is((public.ensure_grants()->>'admin')::boolean, false, 'unverified listed email is not admin');

-- Per-IP visitor limit (3/day): user 1111 used one; 4444 and 5555 fit; 6666 does not.
-- The browser controls the FIRST x-forwarded-for entry; only the last one (added by the proxy) counts.
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.4, 203.0.113.9"}', true);
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 20, 'second visitor from one IP gets credits');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.5, 203.0.113.9"}', true);
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 20, 'third visitor from one IP still gets credits');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.6, 203.0.113.9"}', true);
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 0, 'fourth visitor from one IP on one day gets none');

select * from finish();
rollback;
