-- Apply as the database administrator AFTER creating the credits schema.
-- This is deliberately separate from migrations: the base schema is still planned.
-- Never silently skip a missing table or apply inferred ownership to an unknown one.
begin;

do $$
declare
  unexpected text;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.credit_ledger') is null
     or to_regclass('private.app_settings') is null
     or to_regclass('private.visitor_ip_grants') is null then
    raise exception 'Missing credits tables. Create the planned schema before applying RLS.';
  end if;

  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    into unexpected
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p')
      and c.oid not in ('public.profiles'::regclass, 'public.credit_ledger'::regclass,
                       'private.app_settings'::regclass, 'private.visitor_ip_grants'::regclass)
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
                      and d.objid = c.oid and d.deptype = 'e');
  if unexpected is not null then
    raise exception 'Unreviewed application tables: %. Audit their ownership and add policies first.', unexpected;
  end if;
end $$;

alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;
alter table private.app_settings enable row level security;
alter table private.visitor_ip_grants enable row level security;

-- Permissive policies are ORed together: remove older policies on these four
-- reviewed tables so an existing "allow all" cannot bypass the owner check.
do $$
declare
  p record;
  t record;
  columns text;
  ledger_sequence text;
begin
  for p in select schemaname, tablename, policyname from pg_policies
    where (schemaname = 'public' and tablename in ('profiles', 'credit_ledger'))
       or (schemaname = 'private' and tablename in ('app_settings', 'visitor_ip_grants'))
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;

  -- Table REVOKE does not remove previously granted column privileges.
  for t in select unnest(array['public.profiles'::regclass, 'public.credit_ledger'::regclass,
                              'private.app_settings'::regclass, 'private.visitor_ip_grants'::regclass]) as oid
  loop
    select string_agg(quote_ident(attname), ', ') into columns
      from pg_attribute where attrelid = t.oid and attnum > 0 and not attisdropped;
    execute format('revoke select (%s), insert (%s), update (%s), references (%s) on %s from public, anon, authenticated',
                   columns, columns, columns, columns, t.oid);
  end loop;

  ledger_sequence := pg_get_serial_sequence('public.credit_ledger', 'id');
  if ledger_sequence is not null then
    execute format('revoke all on sequence %s from public, anon, authenticated', ledger_sequence);
    execute format('grant usage, select on sequence %s to service_role', ledger_sequence);
  end if;
end $$;

revoke all on table public.profiles, public.credit_ledger,
  private.app_settings, private.visitor_ip_grants from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

grant usage on schema public to authenticated, service_role;
grant select on table public.profiles, public.credit_ledger to authenticated;
create policy "read own profile" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own ledger" on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()));

-- Settings and IP counters have no user owner. No client policies means default
-- deny. Credits/billing writes also have NO client policy, including own rows.
-- Trusted RPC owners and Supabase's BYPASSRLS service role retain server access.
grant usage on schema private to service_role;
grant select, insert, update, delete on table public.profiles, public.credit_ledger,
  private.app_settings, private.visitor_ip_grants to service_role;

commit;
