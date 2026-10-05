# Database row security

The application currently stores chat projects in browser IndexedDB. Its
Supabase credits schema exists in the implementation plan, not deployed
migrations in this checkout. These scripts prepare that schema's security;
their presence does not mean they have been applied to the hosted database.

| Table | Client access |
| --- | --- |
| `public.profiles` | Read rows where `user_id = auth.uid()` |
| `public.credit_ledger` | Read rows where `user_id = auth.uid()` |
| `private.app_settings` | None; server-owned settings |
| `private.visitor_ip_grants` | None; server-owned abuse counters |

All four tables enable RLS. Unauthenticated `anon` cannot access them. Supabase
anonymous **Auth users** use the `authenticated` role and can read only their
own rows. No client can insert, update, delete, truncate, change ownership,
change a balance, or award itself Pro, even on its own profile. Credit changes
go through the planned RPCs, which must derive the user from `auth.uid()`.

`rls.sql` replaces existing policies on these four tables, removes table and
column grants to clients, and installs the rules above in one transaction.
It rejects missing tables and additional unreviewed application tables in
`public`/`private`. It is safe to reapply after inspecting the schema.
It does not invent ownership columns or alter Supabase-managed tables.

## Applying to the hosted project

1. Authenticate to the confirmed project `qmlhbpwbhcdefwbixcrh` using the
   Supabase CLI or Dashboard; keep credentials outside the repository.
2. Run `audit.sql` using an administrator connection. Review all application
   tables, policies, grants, and security-definer functions. Extend `rls.sql`
   for any additional tables or custom schemas using their actual ownership
   relationships before applying it. A table without a user owner should
   normally deny client access, not receive an invented owner policy.
3. After the four planned tables exist, run `rls.sql` as administrator in the
   SQL editor or with `psql -v ON_ERROR_STOP=1 -f supabase/security/rls.sql` over
   a securely configured connection. Do not use a browser anon key for DDL.
4. Rerun the audit and verify through actual user sessions that user A cannot
   read user B's rows and neither can modify billing or credit records.

The database owner and Supabase `service_role` remain privileged. Keep that
role server-side. RLS is not forced on table owners because the planned
security-definer credit functions require trusted access. Additional
security-definer RPCs and views need their own review; enabling table RLS
does not automatically make them safe.

Every future table migration must enable RLS in the same transaction, revoke
unneeded client privileges, and define explicit owner policies if client
access is required. For writable user content, both `USING` and `WITH CHECK`
must enforce ownership so users cannot transfer rows to another account.

## Local verification

With Docker running:

```sh
node --test tests/security/rls.test.cjs
```

The test creates a temporary PostgreSQL 18 container with no network, tests
the SQL from the planned schema and the hardening script, and removes the
container. No production data or credentials are used. Auth functions are
fixture implementations of Supabase's JWT identity interface; this does
not test the hosted Auth gateway.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
and [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
