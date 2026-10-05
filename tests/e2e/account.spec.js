const { test, expect, sb, openStudio, setProfile } = require('./fixtures');

async function latestMailLink(address){
  for (let i = 0; i < 30; i++){
    const res = await fetch(`${sb.mailUrl}/api/v1/search?query=${encodeURIComponent('to:' + address)}`);
    const { messages } = await res.json();
    if (messages && messages.length){
      const msg = await (await fetch(`${sb.mailUrl}/api/v1/message/${messages[0].ID}`)).json();
      const link = (msg.Text + ' ' + msg.HTML).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/);
      if (link) return link[0].replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no sign-in email for ' + address);
}

test('chip shows the balance and opens the account dialog', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('#creditsChipText')).toHaveText('20 credits');
  await page.click('#creditsChip');
  await expect(page.locator('#accountDialog')).toBeVisible();
  await expect(page.locator('#signInSection')).toBeVisible();
  await expect(page.locator('#accountSection')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#accountDialog')).toBeHidden();
});

test('chip updates after spending', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 1 });
  await expect(page.locator('#creditsChipText')).toHaveText('1 credit');
});

test('magic link converts the visitor and adds the 40 bonus once', async ({ page }) => {
  await openStudio(page);
  const visitorId = await page.evaluate(() => WTCCredits.userId());
  await page.evaluate(() => WTCCredits.spendScreenshot()); // 19 left
  const email = `visitor-${Date.now()}@example.com`;
  await page.click('#creditsChip');
  await page.fill('#magicLinkEmail', email);
  await page.click('#magicLinkForm button[type=submit]');
  await expect(page.locator('#signInStatus')).toContainText('Check your email');

  await page.goto(await latestMailLink(email));
  await expect.poll(() => page.evaluate(() => WTCCredits.get() && WTCCredits.get().email)).toBe(email);
  expect(await page.evaluate(() => WTCCredits.userId())).toBe(visitorId);
  await expect(page.locator('#creditsChipText')).toHaveText('59 credits');
  await page.click('#creditsChip');
  await expect(page.locator('#accountSection')).toBeVisible();
  await expect(page.locator('#accountEmail')).toHaveText(email);
});

test('Google button links the identity to the visitor account', async ({ page }) => {
  let requested = '';
  await page.route('**/auth/v1/user/identities/authorize*', (route) => {
    requested = route.request().url();
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'http://127.0.0.1:8090/app/index.html' }) });
  });
  await openStudio(page);
  await page.click('#creditsChip');
  await page.click('#googleSignInBtn');
  await expect.poll(() => requested).toContain('provider=google');
});

test('sign out starts a fresh visitor session', async ({ page }) => {
  await openStudio(page);
  const before = await page.evaluate(() => WTCCredits.userId());
  await page.evaluate(() => WTCCredits.signOut());
  expect(await page.evaluate(() => WTCCredits.userId())).not.toBe(before);
  await expect(page.locator('#creditsChipText')).toHaveText('20 credits');
});

test('on a 390px phone the header still fits the chip and every button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await openStudio(page);
  await expect(page.locator('#creditsChipText')).toHaveText('20 credits');
  const rights = await page.evaluate(() => ['creditsChip', 'studioThemeBtn', 'openProjectsBtn']
    .map((id) => Math.round(document.getElementById(id).getBoundingClientRect().right)));
  for (const r of rights) expect(r).toBeLessThanOrEqual(390);
});
