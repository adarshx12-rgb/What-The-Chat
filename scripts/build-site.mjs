// Copies the public website into dist/ for Cloudflare Pages. There is no
// real build step: this is an allowlist, so local tooling (server/, tests/,
// supabase/, output/, docs) and the large source files in assets/ (raw demo
// videos, wallpaper source art) never get published. See DEPLOYMENT.md.
import { cpSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');

const FILES = [
  'index.html',
  'about.html',
  'contact.html',
  'privacy-policy.html',
  'terms-and-conditions.html',
  'refund-policy.html',
  '404.html',
  '500.html',
  'robots.txt',
  'sitemap.xml',
  '_headers',
  '.well-known/security.txt',
  'app/index.html',
  'assets/site.css',
  'assets/chat-emoji.js',
  'assets/credits-config.js',
  'assets/credits-core.js',
  'assets/credits.js',
  'assets/app-preview.jpg',
  // Font licences (the fonts are embedded in the pages).
  'assets/Inter-LICENSE.txt',
  'assets/Roboto-LICENSE.txt',
  'assets/NotoEmoji-LICENSE.txt',
];

const MAX_BYTES = 25 * 1024 * 1024; // Cloudflare Pages per-file limit

rmSync(out, { recursive: true, force: true });
let total = 0;
for (const f of FILES){
  const src = join(root, f);
  if (!existsSync(src)) throw new Error('missing public file: ' + f);
  const size = statSync(src).size;
  if (size > MAX_BYTES) throw new Error(f + ' is over the 25 MB Cloudflare Pages limit');
  mkdirSync(dirname(join(out, f)), { recursive: true });
  cpSync(src, join(out, f));
  total += size;
}
console.log(`dist/: ${FILES.length} files, ${(total / 1024 / 1024).toFixed(1)} MB`);
