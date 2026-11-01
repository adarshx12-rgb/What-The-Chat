const { test, expect } = require('@playwright/test');

async function openStudio(page){
  await page.addInitScript(() => localStorage.setItem('wtc-tour-done', '1'));
  await page.route('**/assets/credits-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.WTC_CONFIG = {};' }));
  await page.goto('/app/index.html');
  await page.waitForFunction(() => typeof currentProjectId !== 'undefined' && currentProjectId);
  await page.evaluate(() => Promise.all(['44px ChatInter', '44px ChatRoboto'].map(f => document.fonts.load(f))));
}

test('chat font size scales bubbles, survives reload and defaults old projects to medium', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openStudio(page);
  await page.evaluate(() => {
    state.platform = 'android'; state.generation = 'current';
    state.messages = [{ id: uid(), sender: 'me', text: 'Chad', date: today(), time: '23:42', deleted: false, media: null, replyTo: null, status: 'read', call: null }];
    previewState.revealedCount = 1; renderMessageList();
  });
  const heightAt = (size) => page.evaluate((size) => {
    document.querySelector('#chatFontSizeSeg [data-font-size="' + size + '"]').click();
    const b = buildBlocks(previewCtx, getPlatformTokens(), 1, false, MAX_TEXT_W).blocks.find(x => x.type === 'bubble');
    return b.h;
  }, size);
  const small = await heightAt('small'), large = await heightAt('large'), medium = await heightAt('medium');
  expect(medium).toBeGreaterThanOrEqual(100);
  expect(medium).toBeLessThanOrEqual(110);
  expect(small).toBeLessThan(medium * 0.92);
  expect(large).toBeGreaterThan(medium * 1.08);
  await expect(page.locator('#chatFontSizeSeg [data-font-size="medium"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#chatFontSizeSeg [data-font-size="small"]').click();
  await page.evaluate(() => persistCurrentProject());
  await page.reload();
  await page.waitForFunction(() => typeof currentProjectId !== 'undefined' && currentProjectId);
  expect(await page.evaluate(() => state.chatFontSize)).toBe('small');
  await expect(page.locator('#chatFontSizeSeg [data-font-size="small"]')).toHaveClass(/active/);

  const old = await page.evaluate(() => { const d = serializeProjectData(); delete d.chatFontSize; return deserializeProjectData(d).chatFontSize; });
  expect(old).toBe('medium');
  await page.screenshot({ path: testInfo.outputPath('small.png') });
  expect(errors).toEqual([]);
});
