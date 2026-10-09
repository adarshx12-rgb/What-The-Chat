begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- RLS guard: fails if ANY table in public/private (now or added later) lacks RLS.
select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname, ', '), '')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'private') and not c.relrowsecurity),
  '', 'every table in public and private has RLS enabled');
select policies_are('public', 'profiles', array['read own profile'], 'profiles has only the owner-read policy');
select policies_are('public', 'credit_ledger', array['read own ledger'], 'credit_ledger has only the owner-read policy');

-- Production per-IP limit for this test, regardless of seed.sql.
update private.app_settings set value = '2' where key = 'visitor_ip_daily_limit';

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', null),
  ('22222222-2222-2222-2222-222222222222', 'free.user+promo@googlemail.com'),
  ('33333333-3333-3333-3333-333333333333', 'pro@example.com'),
  ('44444444-4444-4444-4444-444444444444', null),
  ('55555555-5555-5555-5555-555555555555', null),
  ('66666666-6666-6666-6666-666666666666', null),
  ('99999999-9999-9999-9999-999999999991', 'FreeUser@gmail.com'),
  ('99999999-9999-9999-9999-999999999992', 'someone@mailinator.com');
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

select is((public.ensure_grants()->>'credits')::int, 10, 'visitor gets 10 credits');
select is((public.ensure_grants()->>'credits')::int, 10, 'visitor grant is one-time');
select is((public.spend_credits('video', 16)->>'charged')::int, 6, '16 s of video costs 6 credits');
select is((public.spend_credits('video', 600)->>'charged')::int, 4, 'video charge is capped at the balance');
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
select is((public.ensure_grants()->>'credits')::int, 30, 'sign-up bonus is 30');
select is((public.spend_credits('screenshot', 1)->>'credits')::int, 29, 'a screenshot costs 1 credit');
reset role;
update public.profiles set last_refill_at = now() - interval '32 days'
 where user_id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
select is((public.ensure_grants()->>'credits')::int, 29, 'no rollover: refill adds nothing while the balance is 10 or more');
reset role;
update public.profiles set credits = 3, last_refill_at = now() - interval '32 days'
 where user_id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
select is((public.ensure_grants()->>'credits')::int, 10, 'monthly refill tops the balance up to 10');
select is((public.ensure_grants()->>'credits')::int, 10, 'refill happens once per month');

-- Email aliases and disposable domains ---------------------------------------
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999991","role":"authenticated","is_anonymous":false}', true);
select is((public.ensure_grants()->>'credits')::int, 0, 'a Gmail alias (dots, +tag, googlemail) of a claimed email gets no bonus');
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999992","role":"authenticated","is_anonymous":false}', true);
select is((public.ensure_grants()->>'credits')::int, 0, 'a disposable-domain email gets no bonus');
reset role;
update public.profiles set credits = 0, last_refill_at = now() - interval '32 days'
 where user_id = '99999999-9999-9999-9999-999999999991';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999991","role":"authenticated","is_anonymous":false}', true);
select is((public.ensure_grants()->>'credits')::int, 0, 'an alias account gets no monthly refill either');

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

-- Per-IP visitor limit (2/day): user 1111 used one; 4444 fits; 5555 does not.
-- The browser controls the FIRST x-forwarded-for entry; only the last one (added by the proxy) counts.
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.4, 203.0.113.9"}', true);
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 10, 'second visitor from one IP gets credits');
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.5, 203.0.113.9"}', true);
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","is_anonymous":true}', true);
select is((public.ensure_grants()->>'credits')::int, 0, 'third visitor from one IP on one day gets none');

-- Service-role-only functions ------------------------------------------------
select throws_ok($$ select public.grant_credit_pack('order_x', '22222222-2222-2222-2222-222222222222', 100) $$,
                 '42501', null, 'clients cannot grant themselves a credit pack');
select throws_ok($$ select public.billing_rate_ok('22222222-2222-2222-2222-222222222222', 10, 600) $$,
                 '42501', null, 'clients cannot touch the billing rate limit');
reset role;

set local role service_role;
select is(public.grant_credit_pack('order_1', '22222222-2222-2222-2222-222222222222', 100), true, 'a paid pack is granted');
select is(public.grant_credit_pack('order_1', '22222222-2222-2222-2222-222222222222', 100), false, 'the same order is never granted twice');
select is(public.billing_rate_ok('22222222-2222-2222-2222-222222222222', 2, 600), true, 'billing call 1 allowed');
select is(public.billing_rate_ok('22222222-2222-2222-2222-222222222222', 2, 600), true, 'billing call 2 allowed');
select is(public.billing_rate_ok('22222222-2222-2222-2222-222222222222', 2, 600), false, 'billing call 3 over the limit');
reset role;
select is((select credits from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'), 110, 'pack adds 100 credits once');

-- Helpers ----------------------------------------------------------------------
select is(private.normalize_email(' A.B.C+promo@GoogleMail.com '), 'abc@gmail.com', 'Gmail dots, +tag and googlemail normalized');
select is(private.normalize_email('first.last+x@outlook.com'), 'first.last@outlook.com', 'other domains keep dots, drop +tag');
select is((select count(*)::int from cron.job where jobname = 'wtc-cleanup-rate-limits'), 1, 'daily rate-limit cleanup is scheduled');
insert into private.visitor_ip_grants (ip_hash, day, grants) values ('old', current_date - 5, 1);
select private.cleanup_rate_limits();
select is((select count(*)::int from private.visitor_ip_grants where ip_hash = 'old'), 0, 'cleanup removes old visitor IP rows');

-- Account deletion -----------------------------------------------------------
reset role;
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is((select count(*)::int from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'deleting a user removes their profile');
select is((select count(*)::int from public.credit_ledger where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'deleting a user removes their ledger');
select is((select count(*)::int from private.email_claims where user_id is null), 1, 'the email claim survives deletion without an owner');
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999993', 'free.user@gmail.com');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999993","role":"authenticated","is_anonymous":false}', true);
select is((public.ensure_grants()->>'credits')::int, 0, 'signing up again after deleting gets no second bonus');
reset role;
set local role service_role;
select is(public.grant_credit_pack('order_late', '22222222-2222-2222-2222-222222222222', 100), false, 'a late pack webhook for a deleted user is ignored, not an error');
reset role;

select * from finish();
rollback;
