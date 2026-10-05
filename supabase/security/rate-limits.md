# Authentication and API rate limits

The shipped website stores projects in IndexedDB and has no login UI, paid API
calls, or deployed Edge Function implementations in this checkout. The only
implemented expensive route is the local converter; see `server/README.md`.
The credits/account/billing document is a plan, not running endpoint code.

## Supabase Auth configuration

`supabase/config.toml` sets these local Auth limits:

| Operation | Setting | Value |
| --- | --- | --- |
| Password login and other token grants, including refresh | `token_refresh` | 10 per 5 minutes per IP (refill rate) |
| Signup, recovery, resend, OTP requests | `sign_in_sign_ups` | 10 per 5 minutes per IP (refill rate) |
| OTP verification | `token_verifications` | 10 per 5 minutes per IP (refill rate) |
| Anonymous signup | `anonymous_users` | 10 per hour per IP |
| Web3 login | `web3` | 10 per 5 minutes per IP (refill rate) |
| Auth email / SMS sends | `email_sent` / `sms_sent` | 10 per hour per project |
| Repeated email sends to one user | `auth.email.max_frequency` | 60 seconds |

Supabase uses token buckets: most IP limits allow an initial burst of 30,
so a refill rate of 10 is **not** a strict cap of 10 attempts in five minutes.
The token endpoint covers password login as well as refresh; lowering only
the signup limit would miss password brute-force attempts. Built-in SMTP
has its own lower quota; the configured email quota requires custom SMTP
or a Send Email hook. See [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
and [CLI configuration](https://supabase.com/docs/guides/local-development/cli/config).

## Applying and verifying

Restart the local Supabase stack after changing its config. This file does
**not** change hosted settings. Before enabling accounts, apply the same
values under Authentication > Rate Limits in the confirmed hosted project
(`qmlhbpwbhcdefwbixcrh`), and set the email resend interval to 60 seconds.
No hosted configuration has been changed or verified by this repository patch.

In a disposable staging account, exhaust the password token bucket using
incorrect passwords and verify HTTP 429 before further password checking.
Allow for the initial burst. Check signup, recovery, OTP verification, and
anonymous signup similarly, and verify recovery after refilling. Use the
local mail sink for mail tests. Check that routine token refresh still works.
Client-side cooldowns may improve usability but cannot enforce these limits.

When the planned credit and billing endpoints are implemented, enforce shared
server-side quotas before invoking paid providers, with both verified user
and trusted IP limits plus a project-wide spending cap. Do not use this
local converter's in-memory budget across distributed Edge Functions.
