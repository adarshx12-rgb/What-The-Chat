const { test, expect } = require('@playwright/test');

async function openStudio(page){
  await page.addInitScript(() => localStorage.setItem('wtc-tour-done', '1'));
  await page.route('**/assets/credits-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.WTC_CONFIG = {};' }));
  await page.goto('/app/index.html');
  await page.waitForFunction(() => typeof currentProjectId !== 'undefined' && currentProjectId);
}

// Real Android dark-mode bubbles, measured from the creator's own captures (Nov 2 2026).
test('modern Android dark mode uses the measured bubble colours; classic and custom colours are unchanged', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openStudio(page);
  await page.evaluate(() => {
    state.platform = 'android'; state.generation = 'refreshed';
    state.messages = [
      { id: uid(), sender: 'contact', text: 'Bye bye', date: today(), time: '22:46', deleted: false, media: null, replyTo: null, status: 'read', call: null },
      { id: uid(), sender: 'me', text: 'deii eating dinner..u play', date: today(), time: '22:47', deleted: false, media: null, replyTo: null, status: 'read', call: null },
    ];
    previewState.revealedCount = 2; renderMessageList(); syncGenerationControls();
  });
  await page.locator('#chromeDarkBtn').click();

  const fills = () => page.evaluate(() => {
    const t = getPlatformTokens();
    return { me: bubbleFill(true, t), contact: bubbleFill(false, t),
      dotMe: getComputedStyle(document.getElementById('bubbleDotMe')).backgroundColor };
  });
  for (const gen of ['refreshed', 'current']){
    await page.selectOption('#generationSelect', gen);
    const f = await fills();
    expect(f.me).toBe('#254b3a');
    expect(f.contact).toBe('#1f2428');
    expect(f.dotMe).toBe('rgb(37, 75, 58)');
  }
  await page.evaluate(() => revealUpTo(state.messages[1].id));
  await page.waitForTimeout(300);
  await page.locator('#previewCanvas').screenshot({ path: testInfo.outputPath('android-dark.png') });

  // Classic Android keeps its era's teal; iOS keeps its own neutral pair.
  await page.selectOption('#generationSelect', 'classic');
  expect(await fills()).toMatchObject({ me: '#005c4b', contact: '#202c33' });
  await page.locator('#platformIosBtn').click();
  await page.selectOption('#generationSelect', 'current');
  expect(await fills()).toMatchObject({ me: '#254c38', contact: '#232526' });

  // A creator's own colour always wins.
  await page.locator('#platformAndroidBtn').click();
  await page.evaluate(() => {
    const i = document.getElementById('bubbleMeInput'); i.value = '#123456'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect((await fills()).me).toBe('#123456');
  expect(errors).toEqual([]);
});
