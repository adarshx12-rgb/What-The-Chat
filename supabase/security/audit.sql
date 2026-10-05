-- Read-only inventory. Run against the LIVE project before choosing policies.
-- Includes custom schemas; excludes PostgreSQL and Supabase-managed schemas.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       pg_get_userbyid(c.relowner) as table_owner,
       (select jsonb_agg(jsonb_build_object('column', a.attname,
                'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull))
        from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns,
       (select jsonb_agg(jsonb_build_object('name', p.policyname, 'roles', p.roles,
                'command', p.cmd, 'using', p.qual, 'check', p.with_check))
        from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname !~ '^pg_'
  and n.nspname not in ('information_schema', 'auth', 'storage', 'realtime',
    'supabase_functions', 'supabase_migrations', 'extensions', 'vault',
    'graphql', 'graphql_public', '_realtime', '_analytics', 'net', 'cron', 'pgsodium', 'pgsodium_masks')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
                  and d.objid = c.oid and d.deptype = 'e')
order by n.nspname, c.relname;

-- SECURITY DEFINER functions can bypass RLS: review their caller checks and
-- execute grants as well. This prints definitions, not user data or secrets.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner, p.proacl as execute_grants,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef and n.nspname in ('public', 'private');
