-- Visitor grants per IP (Oct 30 2026). Mobile carriers (Jio, Airtel) put many
-- people behind one shared IP (CGNAT), so 2 grants per IP per day left real
-- visitors with 0 credits. Raise it to 10, and let a visitor turned away by
-- the limit try again on a later day instead of marking them done forever.
update private.app_settings set value = '10' where key = 'visitor_ip_daily_limit';

create or replace function public.ensure_grants() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  p public.profiles;
  ip text;
  ip_key text;
  used integer;
  topup integer;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.profiles (user_id) values (uid) on conflict do nothing;
  select * into p from public.profiles where user_id = uid for update;

  if is_anon and not p.visitor_grant_done then
    ip := private.client_ip();
    select encode(extensions.digest(coalesce(nullif(ip, ''), 'unknown') || s.value, 'sha256'), 'hex')
      into ip_key from private.app_settings s where s.key = 'ip_salt';
    insert into private.visitor_ip_grants as g (ip_hash, day, grants) values (ip_key, current_date, 1)
      on conflict (ip_hash, day) do update set grants = g.grants + 1
      returning g.grants into used;
    -- Only a granted visitor is marked done; one over the limit retries later.
    if used <= private.setting_int('visitor_ip_daily_limit') then
      perform private.grant_credits(uid, private.setting_int('visitor_grant'), 'visitor_grant');
      update public.profiles set visitor_grant_done = true where user_id = uid;
    end if;
  end if;

  if not is_anon and not p.signup_bonus_done then
    if private.claim_email_bonus(uid) then
      perform private.grant_credits(uid, private.setting_int('signup_bonus'), 'signup_bonus');
    end if;
    update public.profiles set signup_bonus_done = true, last_refill_at = now() where user_id = uid;
  elsif not is_anon and p.last_refill_at < now() - interval '1 month' then
    -- No rollover: the refill tops the balance up to the refill amount and
    -- never adds on top of unused (or bought) credits.
    topup := private.setting_int('monthly_refill') - p.credits;
    if topup > 0 and private.claim_email_bonus(uid) then
      perform private.grant_credits(uid, topup, 'monthly_refill');
    end if;
    update public.profiles set last_refill_at = now() where user_id = uid;
  end if;

  select * into p from public.profiles where user_id = uid;
  return private.entitlement_json(p);
end $$;

-- Visitors already turned away (marked done without ever receiving the
-- grant) get another chance.
update public.profiles p set visitor_grant_done = false
 where p.visitor_grant_done
   and not exists (select 1 from public.credit_ledger l
                   where l.user_id = p.user_id and l.reason = 'visitor_grant')
   and exists (select 1 from auth.users u
               where u.id = p.user_id and coalesce(u.is_anonymous, false));
