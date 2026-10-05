# Static site publishing

There is no build step. Publish the root HTML pages, `app/index.html`, referenced
public assets, `robots.txt`, and `sitemap.xml`. Include `.htaccess` on Apache.
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

`contact.html` uses `support@example.com` as an explicitly labeled placeholder,
as requested. Replace both its visible address and `mailto:` target, then remove
the placeholder notice when the real inbox is ready. Privacy and terms pages
link to this contact page so the address has a single place to update.
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
