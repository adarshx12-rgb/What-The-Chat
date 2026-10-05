-- Credits for What The Chat. Clients can only read their own rows; every
-- balance change goes through the security-definer functions below.
-- Grants and policy names match supabase/security/rls.sql, so re-running that
-- hardening script never changes what this migration set up.
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

-- Admins get Pro forever. Filled by hand in the dashboard SQL editor, never
-- from the site and never committed (keeps personal emails out of the repo).
create table private.admin_emails (
  email text primary key check (email = lower(email))
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
-- User tables: a signed-in user (anonymous visitors included, they use the
-- `authenticated` role) can SELECT only rows where user_id is their own id.
-- There are deliberately NO insert/update/delete policies: owner-scoped write
-- policies would let a user set their own credits or plan. All writes go
-- through the security-definer functions below (they run as the table owner).
-- Internal tables (private schema): RLS on with no policies = deny all.
alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;
alter table private.app_settings enable row level security;
alter table private.visitor_ip_grants enable row level security;
alter table private.admin_emails enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own ledger" on public.credit_ledger
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Supabase's default privileges grant everything on new tables to the API
-- roles; take it all back, then give signed-in users read access only.
revoke all on table public.profiles, public.credit_ledger,
  private.app_settings, private.visitor_ip_grants, private.admin_emails
  from public, anon, authenticated;
grant select on table public.profiles, public.credit_ledger to authenticated;
do $$
declare seq text := pg_get_serial_sequence('public.credit_ledger', 'id');
begin
  if seq is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', seq);
  end if;
end $$;
grant usage on schema private to service_role;
grant select, insert, update, delete on table public.profiles, public.credit_ledger,
  private.app_settings, private.visitor_ip_grants, private.admin_emails to service_role;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Admin = a non-anonymous user whose VERIFIED email is on the admin list.
create function private.is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join private.admin_emails a on a.email = lower(u.email)
    where u.id = p_user
      and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous, false));
$$;

create function private.entitlement_json(p public.profiles) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'credits', p.credits,
    'admin', private.is_admin(p.user_id),
    'pro', private.is_admin(p.user_id) or (p.plan = 'pro' and coalesce(p.pro_until > now(), false)),
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

  is_pro := (private.entitlement_json(p) ->> 'pro')::boolean;
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
revoke execute on function private.is_admin(uuid), private.entitlement_json(public.profiles),
  private.grant_credits(uuid, integer, text), private.handle_new_user() from public, anon, authenticated;
