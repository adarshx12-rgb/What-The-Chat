# Security

## Reporting a problem

Email **support@whatthechat.com** (also in `/.well-known/security.txt`).
Please don't open a public GitHub issue for a security bug.

## What is protected, and where

| Area | Protection | Where |
| --- | --- | --- |
| Accounts | Supabase Auth: Google or email magic link, anonymous visitors | `assets/credits.js`, `supabase/config.toml` |
| Data access | Row Level Security on every table, no client write policies, pgTAP guard | `supabase/migrations`, `supabase/tests` |
| Credits | Server-side balance (`ensure_grants` / `spend_credits`); watermark is client-side by design | migrations, `app/index.html` |
| Abuse | Visitor IP cap, one bonus per normalized email, disposable domains blocked, billing rate limit | `supabase/security/rate-limits.md` |
| Payments | Razorpay; webhook HMAC check; pack amount checked; idempotent grants | `supabase/functions` |
| Browser | Security headers, SRI on CDN scripts, imported backups whitelisted, data: images only | `.htaccess`, `_headers`, `app/index.html` |
| Privacy | Self-serve account deletion (cancels Pro, deletes data); IPs and emails stored only as hashes | billing function `delete_account` |
| Dependencies | Pinned versions, Dependabot, `npm audit` in CI | `.github/` |

Secrets (service_role key, Razorpay keys, webhook secret) live only in
Supabase secrets. The anon key in `assets/credits-config.js` is public by
design. A unit test fails if a page ships a secret key.

## Hosted settings checklist (Supabase dashboard)

`supabase/config.toml` only configures the local stack. Mirror these in the
hosted project:

- **Authentication > URL Configuration:** Site URL `https://whatthechat.com/app/`;
  redirect URLs only `https://whatthechat.com/app/**` and
  `https://www.whatthechat.com/app/**`.
- **Authentication > Email:** confirm email ON, secure email change ON,
  OTP / magic link expiry **900 s**, resend interval 60 s.
- **Authentication > Passwords:** minimum length 10, letters + digits (the
  site has no password sign-in, but the API accepts passwords).
- **Authentication > Rate Limits:** see `supabase/security/rate-limits.md`.
- **Authentication > Attack Protection:** Turnstile (once the domain is live).
- **Advisors > Security Advisor:** run after every migration; fix any error.
- **Project Settings > Billing / Usage:** set a spend cap and usage alerts.
- **Account:** 2FA on Supabase, Razorpay, Cloudflare, GitHub and Google.

## Monitoring

- Edge Function logs (Supabase > Edge Functions > Logs): look for
  `webhook: bad signature rejected` (someone forging payments),
  `credit pack grant failed`, `profile update failed` and `razorpay ... failed`.
- `supabase/snippets/monitoring.sql`: daily funnel, plan mix, IPs at the
  visitor limit, denied alias sign-ups, billing rate-limit hits, odd balances,
  recent pack orders.
- Razorpay dashboard: turn on email alerts for failed webhooks and disputes.

## Backups and recovery

- **User projects** live only in each browser (IndexedDB). Users protect them
  with Export backup; we hold no copy.
- **Database** (accounts, credits, ledger): Supabase takes daily backups on
  paid plans only. On the free plan, take your own weekly dump:
  `npx supabase db dump --linked -f backup-$(date +%F).sql` (schema) and
  `npx supabase db dump --linked --data-only -f data-$(date +%F).sql` (data).
  Store dumps encrypted, outside the repo (they contain user ids and emails).
- **Restore:** create a new project, `npx supabase db push`, load the data
  dump with `psql`, set the secrets again, redeploy both functions, then
  update `assets/credits-config.js` with the new URL and anon key.
- **Payments** are the source of truth in Razorpay. After a restore, compare
  `private.credit_pack_orders` and active subscriptions against Razorpay.

## Incident response

1. **Contain.** Leaked key or forged payments: rotate that key now (below).
   Abuse wave: lower `visitor_ip_daily_limit`, or turn off anonymous
   sign-ins in the dashboard (the studio then runs in fail-closed offline mode).
2. **Assess.** Check function logs and the monitoring queries for what was
   touched and since when.
3. **Fix** the cause, add a test that would have caught it, deploy.
4. **Notify.** If personal data (emails) leaked, tell affected users, and
   CERT-In within 6 hours (India) / the relevant authority within 72 hours (GDPR).
5. **Write down** what happened and what changed.

### Rotating keys

| Key | How |
| --- | --- |
| Supabase service_role / JWT secret | Dashboard > Project Settings > API > roll; redeploy functions; update `credits-config.js` if the anon key changes |
| Razorpay key id / secret | Razorpay > Settings > API Keys > regenerate; `npx supabase secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=…` |
| Razorpay webhook secret | Razorpay > Webhooks > edit secret; `npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=…` |
| Resend API key (SMTP) | Resend > API Keys > revoke + create; update Supabase Auth SMTP password |
