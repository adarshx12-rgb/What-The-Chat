const { test, expect, openStudio, setProfile, getProfile } = require('./fixtures');

const watermarkNow = (page) => page.evaluate(() => exportWatermarkActive(performance.now()));

async function stopAndDownload(page){
  const download = page.waitForEvent('download');
  await page.click('#fullStopBtn');
  await download;
}

test('watermarks after credits run out and charges at most the balance', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 2 }); // covers 6 s
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  await page.waitForTimeout(2000);
  expect(await watermarkNow(page)).toBe(false);

  // Pausing must not count toward coverage.
  await page.click('#fullPauseBtn');
  await page.waitForTimeout(5000);
  expect(await watermarkNow(page)).toBe(false);
  await page.click('#fullResumeBtn');

  await page.waitForTimeout(5000);
  expect(await watermarkNow(page)).toBe(true);
  await expect(page.locator('#fullRecHelper')).toContainText('watermark');
  await stopAndDownload(page);
  await expect.poll(async () => (await getProfile(page)).credits).toBe(0);
  await expect(page.locator('#toastRegion')).toContainText('watermark');
  expect(await watermarkNow(page)).toBe(false);
});

test('a covered recording charges 1 credit per started 3 s', async ({ page }) => {
  await openStudio(page);
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  await page.waitForTimeout(4000);
  expect(await watermarkNow(page)).toBe(false);
  await stopAndDownload(page);
  await expect.poll(async () => (await getProfile(page)).credits).toBe(18);
});

test('pro records unlimited with no watermark and no charge', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 0, plan: 'pro', pro_until: new Date(Date.now() + 864e5).toISOString() });
  await page.click('#fullStartBtn');
  await page.waitForTimeout(2000);
  expect(await watermarkNow(page)).toBe(false);
  await stopAndDownload(page);
  expect((await getProfile(page)).credits).toBe(0);
});

test('zero credits watermarks from the first frame', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 0 });
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  expect(await watermarkNow(page)).toBe(true);
  await stopAndDownload(page);
});

test('if the balance check fails at Start, the recording is watermarked from the first frame', async ({ page }) => {
  await openStudio(page);
  await page.route('**/rest/v1/rpc/ensure_grants', (r) => r.abort());
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  expect(await watermarkNow(page)).toBe(true);
  await stopAndDownload(page);
});

test('a charge that fails at Stop is retried on the next visit', async ({ page }) => {
  await openStudio(page);
  await page.click('#fullStartBtn');
  await expect(page.locator('#fullRecState')).toHaveText('Recording');
  await page.waitForTimeout(4000);
  await page.route('**/rest/v1/rpc/spend_credits', (r) => r.abort());
  await stopAndDownload(page);
  await page.waitForTimeout(1000);
  expect((await getProfile(page)).credits).toBe(20);
  await page.unroute('**/rest/v1/rpc/spend_credits');
  await page.reload();
  await page.evaluate(() => WTCCredits.ready());
  await expect.poll(async () => (await getProfile(page)).credits).toBe(18);
});
