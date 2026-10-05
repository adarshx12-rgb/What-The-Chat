const { test, expect, openStudio, getProfile } = require('./fixtures');

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
