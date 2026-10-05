const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('refund policy exists, is canonical and in the sitemap', () => {
  const html = read('refund-policy.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/whatthechat\.com\/refund-policy\.html">/);
  assert.match(html, /<h1>Refund &amp; cancellation policy<\/h1>/);
  assert.match(read('sitemap.xml'), /<loc>https:\/\/whatthechat\.com\/refund-policy\.html<\/loc>/);
});

test('every page links the refund policy', () => {
  for (const f of ['index.html', 'about.html', 'contact.html', 'privacy-policy.html', 'terms-and-conditions.html', 'refund-policy.html']){
    assert.match(read(f), /href="refund-policy\.html"/, f);
  }
  assert.match(read('app/index.html'), /href="\.\.\/refund-policy\.html"/);
});

test('privacy policy names the new processors', () => {
  const html = read('privacy-policy.html');
  assert.match(html, /Supabase/);
  assert.match(html, /Razorpay/);
});

test('contact page uses the real support address', () => {
  const html = read('contact.html');
  assert.doesNotMatch(html, /example\.com/);
  assert.match(html, /href="mailto:support@whatthechat\.com">support@whatthechat\.com<\/a>/);
});

test('no page ships a secret key', () => {
  for (const f of ['assets/credits-config.js', 'assets/credits.js', 'assets/credits-core.js', 'app/index.html', 'index.html']){
    const text = read(f);
    assert.doesNotMatch(text, /sb_secret_/, f);
    for (const jwt of text.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || []){
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
      assert.notEqual(payload.role, 'service_role', f + ' ships a service_role JWT');
    }
  }
});
