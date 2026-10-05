const { test, expect, openStudio, getProfile, setProfile } = require('./fixtures');

test('a new visitor gets an anonymous session with 20 credits', async ({ page }) => {
  const ent = await openStudio(page);
  expect(ent).toMatchObject({ credits: 20, pro: false, isAnonymous: true, offline: false });
  expect((await getProfile(page)).visitor_grant_done).toBe(true);
});

test('reloading keeps the same visitor and does not re-grant', async ({ page }) => {
  await openStudio(page);
  const id = await page.evaluate(() => WTCCredits.userId());
  await page.reload();
  const ent = await page.evaluate(() => WTCCredits.ready());
  expect(await page.evaluate(() => WTCCredits.userId())).toBe(id);
  expect(ent.credits).toBe(20);
});

test('spendScreenshot and chargeVideo hit the server', async ({ page }) => {
  await openStudio(page);
  const shot = await page.evaluate(() => WTCCredits.spendScreenshot());
  expect(shot.allowed).toBe(true);
  expect(shot.entitlement.credits).toBe(19);
  const ent = await page.evaluate(() => WTCCredits.chargeVideo(30000));
  expect(ent.credits).toBe(9);
});

test('offline mode: no Supabase means 0 credits, no errors', async ({ page }) => {
  await page.route('**/auth/v1/**', (r) => r.abort());
  await page.route('**/rest/v1/**', (r) => r.abort());
  const ent = await openStudio(page);
  expect(ent).toMatchObject({ credits: 0, pro: false, offline: true });
  const shot = await page.evaluate(() => WTCCredits.spendScreenshot());
  expect(shot.allowed).toBe(false);
});

test('a Pro user who goes offline keeps Pro until it expires', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { plan: 'pro', pro_until: new Date(Date.now() + 5 * 864e5).toISOString() });
  await page.route('**/auth/v1/**', (r) => r.abort());
  await page.route('**/rest/v1/**', (r) => r.abort());
  await page.reload();
  const ent = await page.evaluate(() => WTCCredits.ready());
  expect(ent).toMatchObject({ pro: true, offline: true });
  await expect(page.locator('#creditsChipText')).toHaveText('Pro');
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  expect(await page.evaluate(() => exportWatermarkActive(performance.now()))).toBe(false);
});

test('an expired cached Pro does not survive offline', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { plan: 'pro', pro_until: new Date(Date.now() + 5 * 864e5).toISOString() });
  await page.evaluate(() => localStorage.setItem('wtc-pro-until', new Date(Date.now() - 1000).toISOString()));
  await page.route('**/auth/v1/**', (r) => r.abort());
  await page.route('**/rest/v1/**', (r) => r.abort());
  await page.reload();
  expect(await page.evaluate(() => WTCCredits.ready())).toMatchObject({ pro: false, offline: true });
});
