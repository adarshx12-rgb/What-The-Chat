-- Credit plan (Oct 2026) + security hardening.
--  * Amounts: visitor 10 (once), sign-in 30 (once), monthly top-up to 10 (no rollover).
--  * Visitor grants: at most 2 per IP per day.
--  * Sign-in bonus and refills go to ONE account per normalized email
--    (Gmail dots and +tags removed) and never to disposable-email domains.
--  * Credit packs (one-time Razorpay orders), granted once per order.
--  * Per-user rate limit for the billing function.
--  * Daily pg_cron cleanup of the short-lived rate-limit tables.

update private.app_settings set value = '2' where key = 'visitor_ip_daily_limit';
insert into private.app_settings (key, value) values
  ('visitor_grant', '10'), ('signup_bonus', '30'), ('monthly_refill', '10')
  on conflict (key) do update set value = excluded.value;

alter table public.credit_ledger drop constraint credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check check (reason in
  ('visitor_grant', 'signup_bonus', 'monthly_refill', 'screenshot', 'video', 'credit_pack'));

-- One owner per normalized email. Stores a hash, not the address.
create table private.email_claims (
  email_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create table private.disposable_email_domains (domain text primary key check (domain = lower(domain)));
insert into private.disposable_email_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'), ('sharklasers.com'),
  ('grr.la'), ('10minutemail.com'), ('10minutemail.net'), ('tempmail.com'), ('temp-mail.org'), ('temp-mail.io'),
  ('tempmail.net'), ('tempmailo.com'), ('tempr.email'), ('yopmail.com'), ('yopmail.net'), ('getnada.com'),
  ('nada.email'), ('throwawaymail.com'), ('trashmail.com'), ('trashmail.de'), ('dispostable.com'),
  ('maildrop.cc'), ('mailnesia.com'), ('mintemail.com'), ('mohmal.com'), ('emailondeck.com'),
  ('fakeinbox.com'), ('mytemp.email'), ('tmpmail.org'), ('tmpmail.net'), ('mail.tm'), ('mail.gw'),
  ('burnermail.io'), ('spamgourmet.com'), ('discard.email'), ('33mail.com'), ('inboxkitten.com'),
  ('emailfake.com'), ('crazymailing.com'), ('tempinbox.com'), ('fexpost.com'), ('moakt.com');

create table private.credit_pack_orders (
  order_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  credits integer not null check (credits > 0),
  created_at timestamptz not null default now()
);

create table private.billing_calls (
  user_id uuid not null,
  window_start timestamptz not null,
  calls integer not null default 0,
  primary key (user_id, window_start)
);

alter table private.email_claims enable row level security;
alter table private.disposable_email_domains enable row level security;
alter table private.credit_pack_orders enable row level security;
alter table private.billing_calls enable row level security;
revoke all on table private.email_claims, private.disposable_email_domains,
  private.credit_pack_orders, private.billing_calls from public, anon, authenticated;
grant select, insert, update, delete on table private.email_claims, private.disposable_email_domains,
  private.credit_pack_orders, private.billing_calls to service_role;

create function private.setting_int(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select value::integer from private.app_settings where key = p_key;
$$;

-- a.b.c+promo@googlemail.com -> abc@gmail.com; other+tag@x.com -> other@x.com
create function private.normalize_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  v_local text;
  v_domain text;
begin
  if position('@' in e) = 0 then return null; end if;
  v_local := split_part(e, '@', 1);
  v_domain := substr(e, length(v_local) + 2);
  v_local := split_part(v_local, '+', 1);
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;
  if v_local = '' or v_domain = '' then return null; end if;
  return v_local || '@' || v_domain;
end $$;

-- True when this user may receive the sign-in bonus / refills: a real email,
-- not a disposable domain, and the first account to claim that normalized
-- address (later aliases of it get none).
create function private.claim_email_bonus(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  norm text;
  v_key text;
  v_owner uuid;
begin
  select private.normalize_email(u.email) into norm from auth.users u where u.id = p_user;
  if norm is null then return false; end if;
  if exists (select 1 from private.disposable_email_domains d where d.domain = split_part(norm, '@', 2)) then
    return false;
  end if;
  v_key := encode(extensions.digest(norm, 'sha256'), 'hex');
  insert into private.email_claims (email_hash, user_id) values (v_key, p_user) on conflict do nothing;
  select c.user_id into v_owner from private.email_claims c where c.email_hash = v_key;
  return v_owner = p_user;
end $$;

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
    if used <= private.setting_int('visitor_ip_daily_limit') then
      perform private.grant_credits(uid, private.setting_int('visitor_grant'), 'visitor_grant');
    end if;
    update public.profiles set visitor_grant_done = true where user_id = uid;
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

-- Called only by the razorpay-webhook function (service_role) after it has
-- verified the signature and the paid amount. Idempotent per order.
create function public.grant_credit_pack(p_order_id text, p_user uuid, p_credits integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare inserted text;
begin
  if p_order_id is null or p_user is null or p_credits is null or p_credits <= 0 or p_credits > 10000 then
    raise exception 'bad pack' using errcode = '22023';
  end if;
  insert into private.credit_pack_orders (order_id, user_id, credits) values (p_order_id, p_user, p_credits)
    on conflict do nothing returning order_id into inserted;
  if inserted is null then return false; end if;
  perform private.grant_credits(p_user, p_credits, 'credit_pack');
  return true;
end $$;

-- Fixed-window limit for the billing function: true while the user has made
-- at most p_limit calls in the current p_window_seconds window.
create function public.billing_rate_ok(p_user uuid, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  win timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into private.billing_calls as b (user_id, window_start, calls) values (p_user, win, 1)
    on conflict (user_id, window_start) do update set calls = b.calls + 1
    returning b.calls into n;
  return n <= p_limit;
end $$;

create function private.cleanup_rate_limits() returns void
language sql security definer set search_path = '' as $$
  delete from private.visitor_ip_grants where day < current_date - 2;
  delete from private.billing_calls where window_start < now() - interval '1 day';
$$;

revoke execute on function public.grant_credit_pack(text, uuid, integer), public.billing_rate_ok(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.grant_credit_pack(text, uuid, integer), public.billing_rate_ok(uuid, integer, integer)
  to service_role;
revoke execute on function private.setting_int(text), private.normalize_email(text), private.claim_email_bonus(uuid),
  private.cleanup_rate_limits() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('wtc-cleanup-rate-limits', '17 3 * * *', 'select private.cleanup_rate_limits()');
