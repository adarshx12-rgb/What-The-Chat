-- What The Chat: monitoring queries. Paste one block at a time into the
-- Supabase SQL editor (it runs as postgres, so private tables are visible).
-- Read-only. Nothing here exposes emails or raw IP addresses.

-- 1. Daily funnel: new visitors, sign-ins, Pro, packs (last 14 days).
select d::date as day,
  (select count(*) from public.credit_ledger l where l.reason = 'visitor_grant' and l.created_at::date = d::date) as visitor_grants,
  (select count(*) from public.credit_ledger l where l.reason = 'signup_bonus' and l.created_at::date = d::date) as signups_with_bonus,
  (select count(*) from public.credit_ledger l where l.reason = 'credit_pack' and l.created_at::date = d::date) as packs_sold,
  (select count(*) from public.credit_ledger l where l.reason in ('screenshot', 'video') and l.created_at::date = d::date) as paid_exports
from generate_series(current_date - 13, current_date, interval '1 day') d
order by day desc;

-- 2. Current plan mix.
select count(*) filter (where plan = 'pro' and pro_until > now()) as active_pro,
       count(*) filter (where credits = 0 and not (plan = 'pro' and coalesce(pro_until > now(), false))) as out_of_credits,
       count(*) as all_profiles
from public.profiles;

-- 3. Abuse: IP hashes that hit the visitor limit today (2 grants per day).
select ip_hash, grants
from private.visitor_ip_grants
where day = current_date and grants > (select value::int from private.app_settings where key = 'visitor_ip_daily_limit')
order by grants desc limit 20;

-- 4. Abuse: signed-in accounts denied the bonus (an alias of an email that
--    already claimed it, or a disposable domain), last 7 days.
select count(*) as denied_signups
from public.profiles p
where p.signup_bonus_done and p.last_refill_at > now() - interval '7 days'
  and not exists (select 1 from public.credit_ledger l where l.user_id = p.user_id and l.reason = 'signup_bonus');

-- 5. Abuse: users hitting the billing rate limit (10 per 10 minutes) today.
select user_id, sum(calls) as calls, max(calls) as worst_window
from private.billing_calls
where window_start > now() - interval '1 day'
group by user_id having max(calls) > 10
order by calls desc limit 20;

-- 6. Sanity: no balance should ever be negative or absurdly large.
select user_id, credits from public.profiles where credits < 0 or credits > 5000;

-- 7. Payments: the latest credit-pack orders (match these to Razorpay).
select order_id, user_id, credits, created_at from private.credit_pack_orders order by created_at desc limit 20;
