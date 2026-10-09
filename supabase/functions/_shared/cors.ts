// Browsers may only call the billing function from the site itself (plus the
// local test server). Extra origins can be added with ALLOWED_ORIGINS
// (comma-separated), e.g. for a staging domain.
export const DEFAULT_ORIGINS = [
  'https://whatthechat.com',
  'https://www.whatthechat.com',
  'http://127.0.0.1:8090',
  'http://localhost:8090',
];

export function corsHeaders(origin: string | null, extra = ''): Record<string, string> {
  const allowed = [...DEFAULT_ORIGINS, ...extra.split(',').map((o) => o.trim()).filter(Boolean)];
  return {
    'access-control-allow-origin': origin && allowed.includes(origin) ? origin : DEFAULT_ORIGINS[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}
