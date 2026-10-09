# Rate limits

What The Chat has three layers of limits. Local values (in this repo) are for
testing; production values are set by hand in the Supabase dashboard.

## 1. Supabase Auth (sign-in, anonymous visitors, emails)

| Setting | Local (`supabase/config.toml`) | Production (dashboard: Authentication > Rate Limits) |
| --- | --- | --- |
| Anonymous sign-ins per hour per IP (`anonymous_users`) | 10 | **30** |
| Emails sent per hour, project-wide (`email_sent`) | 10 | **100** (needs custom SMTP: Resend) |
| Sign-up / sign-in requests per 5 min per IP (`sign_in_sign_ups`) | 10 | 10 (default is fine) |
| OTP / magic-link verifications per 5 min per IP (`token_verifications`) | 10 | 10 |
| Token grants incl. refresh per 5 min per IP (`token_refresh`) | 10 | default |
| Minimum gap between emails to one address (`auth.email.max_frequency`) | 60 s | **60 s** (Authentication > Email > resend interval) |

Supabase uses token buckets: most per-IP limits allow an initial burst, so a
refill rate of 10 is not a strict cap of 10 requests. Changing
`config.toml` only affects the local stack (restart it after editing). See
[Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

Indian mobile networks put many users behind one IP (CGNAT), so the
anonymous limit is kept generous (30/hour). Abuse is limited by the credit
rules below instead.

## 2. Credits (database, `supabase/migrations`)

- **Visitor grant:** 10 credits once per anonymous account, and at most
  **2 grants per IP per day** (`private.app_settings.visitor_ip_daily_limit`).
  The IP is stored only as a salted daily hash and deleted after 2 days by the
  `wtc-cleanup-rate-limits` pg_cron job. `supabase/seed.sql` raises the limit
  to 1000 locally, because e2e tests create many visitors from 127.0.0.1.
- **Sign-in bonus and monthly top-up:** only for the first account per
  normalized email (Gmail dots and +tags removed, googlemail = gmail) and
  never for disposable domains (`private.disposable_email_domains`; add more
  rows in the SQL editor as you find them).

## 3. Billing function (`supabase/functions/billing`)

- **10 calls per user per 10 minutes** (`public.billing_rate_ok`), checked
  before any Razorpay API call. Over the limit returns HTTP 429.
- Only signed-in, non-anonymous users can call it.
- CORS allows only `https://whatthechat.com`, `https://www.whatthechat.com`
  and the local test server (`127.0.0.1:8090`, `localhost:8090`). Add a
  staging origin with the `ALLOWED_ORIGINS` secret (comma-separated).

## Still to do (needs the live domain)

- Cloudflare Turnstile on anonymous sign-in and email sign-in
  (Authentication > Attack Protection), then `captchaToken` in
  `assets/credits.js`.

## Verifying production

After changing the dashboard values, in a staging project: exhaust the
anonymous and sign-in limits and confirm HTTP 429, then confirm normal
sign-in and token refresh still work after the bucket refills. Use a
disposable test account, never a real user's.
