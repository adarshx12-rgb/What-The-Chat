const { test: base, expect } = require('@playwright/test');
const { execSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const repoRoot = path.resolve(__dirname, '..', '..');

function readLocalSupabase(){
  const out = execSync('npx supabase status -o env', { cwd: repoRoot, encoding: 'utf8' });
  const env = {};
  for (const line of out.split(/\r?\n/)){
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return {
    url: env.API_URL,
    anonKey: env.ANON_KEY,
    serviceKey: env.SERVICE_ROLE_KEY,
    mailUrl: env.MAILPIT_URL || env.INBUCKET_URL || 'http://127.0.0.1:54324',
  };
}

const sb = readLocalSupabase();
const admin = createClient(sb.url, sb.serviceKey, { auth: { persistSession: false } });

const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/assets/credits-config.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.WTC_CONFIG = ' + JSON.stringify({
        supabaseUrl: sb.url, supabaseAnonKey: sb.anonKey, prices: { INR: '₹499', USD: '$8' },
      }) + ';',
    }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});

async function openStudio(page){
  await page.goto('/app/index.html');
  return page.evaluate(() => WTCCredits.ready());
}

async function setProfile(page, fields){
  const id = await page.evaluate(() => WTCCredits.userId());
  const { error } = await admin.from('profiles').update(fields).eq('user_id', id);
  if (error) throw error;
  return page.evaluate(() => WTCCredits.refresh());
}

async function getProfile(page){
  const id = await page.evaluate(() => WTCCredits.userId());
  const { data, error } = await admin.from('profiles').select('*').eq('user_id', id).single();
  if (error) throw error;
  return data;
}

module.exports = { test, expect, admin, sb, openStudio, setProfile, getProfile };
