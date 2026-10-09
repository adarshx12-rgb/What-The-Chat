# Static site publishing

There is no build step. Publish the root HTML pages (including `refund-policy.html`), `app/index.html`, referenced
public assets, `robots.txt`, `sitemap.xml` and `.well-known/security.txt`.
Security headers live in `.htaccess` (Apache, needs `mod_headers`) and `_headers`
(Cloudflare Pages / Netlify); keep the two in sync. Renew the `Expires` date in
`security.txt` before 2027-10-10.
Do not publish the repository metadata, local tooling, `output/`, `growing-giant/`,
or `server/`. The server directory is an optional local MP4 converter, not the
website server. Robots exclusions are crawl hints, not access controls.

The canonical production origin is `https://whatthechat.com`. The homepage uses
`/`, the studio uses `/app/`, and the information pages use their `.html` paths.
Keep those URLs consistent across canonicals, social tags, JSON-LD, and the
sitemap when changing domains. Keep directory-index serving enabled. Project
query strings are intentionally absent from the studio canonical and sitemap.
Normal navigation uses relative paths so it also works when opening local files.

## Contact details

`contact.html` lists `support@whatthechat.com`, received through Cloudflare Email
Routing (receive-only; sign-in emails are sent through Supabase custom SMTP).
Privacy, terms and refund pages link to this contact page so the address has a
single place to update.
Confirm the operator's details and actual hosting/log retention practices when
the host is selected, and update the privacy notice accordingly.

## Error responses

`404.html` and `500.html` are self-contained, use `noindex, follow`, and are
excluded from the sitemap. Inline styles avoid dependencies during an outage.
Their recovery links are root-relative so they work for deeply nested missing
URLs. A subdirectory deployment needs those links and error paths adjusted.

On Apache, the included `.htaccess` maps HTTP 404 and 500 to the two documents.
The host must permit `AllowOverride FileInfo`. See the official
[Apache error-document documentation](https://httpd.apache.org/docs/2.4/custom-error.html).
Other hosts need their equivalent error-document configuration; `.htaccess`
does not configure Netlify, Vercel, Cloudflare Pages, or a CDN's own error pages.
No hosting provider has been selected in this repository.

Supabase Auth limits are configured locally in `supabase/config.toml`.
Hosted Auth needs the separate settings and verification described in
[the rate-limit deployment notes](supabase/security/rate-limits.md).

Do not redirect missing URLs to the homepage or rewrite them with status 200.
An actual missing request must remain 404, and a server failure must remain 500.
Loading `/500.html` directly on a static host only previews the document; HTML
cannot itself set an HTTP response status. A host/CDN outage may use the
provider's own error response. See
[Google's HTTP status guidance](https://developers.google.com/crawling/docs/troubleshooting/http-status-codes).

After publishing, check a missing nested URL for the custom body and HTTP 404.
Verify the 500 mapping using a controlled server-side failure in staging.
Verify `/robots.txt` and `/sitemap.xml` return HTTP 200, and that every sitemap URL
resolves to its intended canonical page. The sitemap contains only canonical
indexable pages, following
[Google's sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## Accounts, credits and billing (Supabase + Razorpay)

Publish `assets/credits-config.js`, `assets/credits-core.js` and `assets/credits.js`
with the site. Do not publish `supabase/` or `tests/`. The anon key in
`credits-config.js` is public by design; RLS in `supabase/migrations` protects
the data. The service_role key and Razorpay secrets live only in Supabase
secrets (`npx supabase secrets set`).

Database changes: add a migration in `supabase/migrations/`, test locally with
`npx supabase db reset && npx supabase test db`, then `npx supabase db push`.
Functions: `npx supabase functions deploy billing` and
`npx supabase functions deploy razorpay-webhook --no-verify-jwt`.

Razorpay setup for billing:
- Plans: monthly `RAZORPAY_PLAN_USD` / `RAZORPAY_PLAN_INR` ($8 / ₹499) and yearly
  `RAZORPAY_PLAN_USD_YEARLY` / `RAZORPAY_PLAN_INR_YEARLY` ($64 / ₹3,999). Without the
  yearly secrets, Yearly checkout shows "not available yet".
- Credit pack: 100 credits for ₹149 / $2, set in `supabase/functions/_shared/razorpay.ts`
  (`CREDIT_PACK`) and shown from `assets/credits-config.js`. Keep both in sync.
- Webhook events: `subscription.activated`, `subscription.charged`,
  `subscription.resumed`, `subscription.cancelled`, `subscription.completed`,
  `subscription.halted`, and **`order.paid`** (credit packs).
- Optional secret `ALLOWED_ORIGINS` adds extra CORS origins for the billing function.

Tests: `cd tests && npm install`, then `npm run unit`, `npx playwright test`
(needs `npx supabase start`), and `npm run integration` (needs
`npx supabase functions serve --env-file supabase/functions/.env.test`).

The admin list (`private.admin_emails`) is filled by hand in the Supabase SQL
editor and never committed. Local tests serve the site on port 8090 (8080 is
often taken by other Docker projects).
