// Runs without Supabase: homepage nav, pricing toggle and the sign-in link.
const { test, expect } = require('@playwright/test');

test('nav has Pricing and Sign in; pricing switches currency', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html');
  await expect(page.locator('nav a[href="#pricing"]')).toBeVisible();
  const signIn = page.locator('nav [data-signin-link]');
  await expect(signIn).toHaveText('Sign in');
  await expect(signIn).toHaveAttribute('href', 'app/index.html?signin=1');

  await page.click('nav a[href="#pricing"]');
  await expect(page.locator('#pricing-heading')).toBeInViewport();
  await page.click('.price-toggle [data-currency="INR"]');
  await expect(page.locator('#pricing')).toContainText('₹499');
  await expect(page.locator('#pricing')).toContainText('₹3,999');
  await expect(page.locator('#pricing')).toContainText('₹149');
  await page.click('.price-toggle [data-currency="USD"]');
  await expect(page.locator('#pricing')).toContainText('$8');
  await expect(page.locator('#pricing')).toContainText('$2.99');
  await expect(page.locator('.price-toggle [data-currency="USD"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a signed-in session shows Account instead of Sign in', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb-qmlhbpwbhcdefwbixcrh-auth-token',
    JSON.stringify({ user: { id: 'u', is_anonymous: false } })));
  await page.goto('/index.html');
  await expect(page.locator('nav [data-signin-link]')).toHaveText('Account');
});

test('mobile menu has Pricing and Sign in, and the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto('/index.html');
  await page.click('#menuToggle');
  await expect(page.locator('#mobileMenu a[href="#pricing"]')).toBeVisible();
  await expect(page.locator('#mobileMenu [data-signin-link]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('?signin=1 opens the studio account dialog and cleans the URL', async ({ page }) => {
  await page.route('**/assets/credits-config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.WTC_CONFIG = {};' }));
  await page.goto('/app/index.html?signin=1');
  await expect(page.locator('#accountDialog')).toBeVisible();
  await expect(page.locator('#signInSection')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('signin')).toBe(false);
});
