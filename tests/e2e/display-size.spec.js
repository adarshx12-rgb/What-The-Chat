const { test, expect } = require('@playwright/test');

async function openStudio(page){
  await page.addInitScript(() => localStorage.setItem('wtc-tour-done', '1'));
  await page.route('**/assets/credits-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.WTC_CONFIG = {};' }));
  await page.goto('/app/index.html');
  await page.waitForFunction(() => typeof currentProjectId !== 'undefined' && currentProjectId);
  await page.evaluate(() => document.fonts.load('46px ChatRoboto'));
}

test('phone display size scales the Android UI, saves, and keeps hit targets aligned', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openStudio(page);
  await page.locator('#platformAndroidBtn').click();
  await page.selectOption('#generationSelect', 'current');
  await expect(page.locator('#displaySizeField')).toBeVisible();
  await expect(page.locator('#displaySizeSelect')).toHaveValue('393');

  const measure = () => page.evaluate(() => {
    draw(previewCtx, performance.now());
    const t = getPlatformTokens();
    const { field } = getComposerLayout(0, 0, VW, FOOTER_H);
    return { scale: VIEW_SCALE, vw: VW, headerBottom: (t.statusBarH + t.headerH) * VIEW_SCALE,
      fieldRight: (field.x + field.w) * VIEW_SCALE, maxBubble: MAX_BUBBLE_W * VIEW_SCALE };
  });
  const std = await measure();
  expect(std.scale).toBe(1);
  expect(std.headerBottom).toBe(220);

  await page.selectOption('#displaySizeSelect', '412');
  const pixel = await measure();
  expect(pixel.scale).toBeCloseTo(393 / 412, 5);
  expect(pixel.headerBottom).toBeCloseTo(220 * 393 / 412, 3);
  // Proportional layout: the composer pill and bubble width still span the same share of the screen.
  expect(Math.abs(pixel.fieldRight - std.fieldRight)).toBeLessThan(12);
  expect(Math.abs(pixel.maxBubble - std.maxBubble)).toBeLessThan(2);

  await page.selectOption('#displaySizeSelect', '360');
  const samsung = await measure();
  expect(samsung.scale).toBeCloseTo(393 / 360, 5);
  expect(samsung.fieldRight).toBeLessThan(1080 - 100); // mic button stays on screen

  // The invisible composer <input> sits over the canvas-drawn field at this scale.
  await page.waitForTimeout(300);
  const align = await page.evaluate(() => {
    const t = getPlatformTokens();
    const footerH = FOOTER_H + getComposerFooterExtraH();
    const { field } = getComposerLayout(0, VH - footerH - t.navBarH + (footerH - FOOTER_H), VW, FOOTER_H);
    const c = previewCanvas.getBoundingClientRect(), i = composerInputEl.getBoundingClientRect();
    const k = c.width / CANVAS_W;
    return { dx: Math.abs((i.left - c.left) - field.x * VIEW_SCALE * k), dw: Math.abs(i.width - field.w * VIEW_SCALE * k) };
  });
  expect(align.dx).toBeLessThan(1.5);
  expect(align.dw).toBeLessThan(1.5);

  // Status bar left out: the crop follows the scaled status bar height.
  const crop = await page.evaluate(() => { state.statusBar.hidden = true; const v = exportCropTop(); state.statusBar.hidden = false; return v; });
  expect(crop).toBe(Math.round(66 * 393 / 360 / 2) * 2);

  // iOS ignores it and hides the control.
  await page.locator('#platformIosBtn').click();
  await expect(page.locator('#displaySizeField')).toBeHidden();
  expect((await measure()).scale).toBe(1);
  await page.locator('#platformAndroidBtn').click();

  // Saved with the project; old projects load as standard.
  await page.evaluate(() => persistCurrentProject());
  await page.reload();
  await page.waitForFunction(() => typeof currentProjectId !== 'undefined' && currentProjectId);
  expect(await page.evaluate(() => state.displayDp)).toBe(360);
  await expect(page.locator('#displaySizeSelect')).toHaveValue('360');
  const old = await page.evaluate(() => { const d = serializeProjectData(); delete d.displayDp; return deserializeProjectData(d).displayDp; });
  expect(old).toBe(393);
  const bad = await page.evaluate(() => { const d = serializeProjectData(); d.displayDp = 999; return deserializeProjectData(d).displayDp; });
  expect(bad).toBe(393);

  await page.screenshot({ path: testInfo.outputPath('display-360.png') });
  expect(errors).toEqual([]);
});
