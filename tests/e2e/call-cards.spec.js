const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

async function openStudio(page){
  await page.addInitScript(() => localStorage.setItem('wtc-tour-done', '1'));
  await page.route('**/assets/credits-config.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.WTC_CONFIG = {};' }));
  await page.goto('/app/index.html');
  await page.waitForFunction(() => typeof currentProjectId !== 'undefined' && currentProjectId);
  await page.evaluate(async () => {
    await Promise.all(['600 44px ChatInter', '600 44px ChatRoboto', '40px ChatInter', '40px ChatRoboto'].map(f => document.fonts.load(f)));
    await modernWallpaperImg.decode();
  });
}

test('call duration survives editing, missed/answered changes, reload and backup import', async ({ page }) => {
  await openStudio(page);
  await page.evaluate(() => {
    state.generation = 'current'; state.platform = 'ios';
    state.messages = [{ id: uid(), sender: 'contact', text: '', date: today(), time: '09:41', deleted: false, media: null, replyTo: null, status: 'read', call: { video: false, missed: false, h: 0, min: 0, sec: 14 } }];
    previewState.revealedCount = 1; renderMessageList();
  });
  await expect(page.getByRole('spinbutton', {name: 'Call seconds', exact: true})).toHaveValue('14');
  await page.getByRole('spinbutton', {name: 'Call seconds', exact: true}).fill('34');
  expect(await page.evaluate(() => callTexts(state.messages[0]).sub)).toBe('34 sec');
  await page.getByRole('combobox', {name: 'Call result', exact: true}).selectOption('missed');
  expect(await page.evaluate(() => callTexts(state.messages[0]))).toEqual({title: 'Missed voice call', sub: 'Tap to call back', red: true});
  await page.getByRole('combobox', {name: 'Call type', exact: true}).selectOption('video');
  await page.getByRole('combobox', {name: 'Call result', exact: true}).selectOption('answered');
  await page.evaluate(() => persistCurrentProject());
  await page.reload();
  await page.waitForFunction(() => typeof currentProjectId !== 'undefined' && currentProjectId);
  expect(await page.evaluate(() => callTexts(state.messages[0]))).toEqual({title: 'Video call', sub: '34 sec', red: false});
  const imported = await page.evaluate(() => {
    const backup = JSON.parse(JSON.stringify(serializeProjectData()));
    const current = deserializeProjectData(backup).messages[0].call;
    delete backup.messages[0].call.sec; backup.messages[0].call.min = 2;
    const oldMinutes = deserializeProjectData(backup).messages[0].call;
    backup.messages[0].call = {video: true}; backup.messages[0].text = '45 sec';
    const oldText = deserializeProjectData(backup).messages[0].call;
    return {current, oldMinutes, oldText};
  });
  expect(imported.current).toMatchObject({sec: 34, min: 0, video: true});
  expect(imported.oldMinutes).toMatchObject({sec: 0, min: 2});
  expect(imported.oldText).toMatchObject({sec: 45, min: 0, video: true});
});

test('all call variants fit their cards and omit delivery ticks; Gen 1 stays excluded', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await openStudio(page);
  const results = await page.evaluate(() => {
    const results = [];
    for (const platform of ['ios', 'android']) for (const generation of ['refreshed', 'current']) for (const mode of ['light', 'dark']) {
      state.platform = platform; state.generation = generation; state.theme.chromeMode = mode;
      for (const video of [false, true]) for (const missed of [false, true]) for (const sender of ['contact', 'me']) {
        const m = {id: uid(), sender, date: today(), time: '23:59', text: '', deleted: false, status: 'read', media: null, replyTo: null, call: {video, missed, h: 99, min: 59, sec: 59}};
        state.messages = [m]; previewState.revealedCount = 1;
        const tokens = getPlatformTokens();
        const block = buildBlocks(previewCtx, tokens, 1, false, MAX_TEXT_W).blocks.find(b => b.type === 'bubble');
        const card = block.callCard;
        const textCalls = [];
        const context = document.createElement('canvas').getContext('2d');
        context.canvas.width = 1080; context.canvas.height = 500;
        context.fillText = function(text, x, y) {
          const width = this.measureText(text).width;
          const left = this.textAlign === 'right' ? x - width : this.textAlign === 'center' ? x - width / 2 : x;
          textCalls.push({text, left, right: left + width, y});
        };
        drawCallCard(context, tokens, mode, m, card, 0, 0);
        let ticks = 0; const original = drawTicks; drawTicks = () => ticks++;
        draw(previewCtx, performance.now()); drawTicks = original;
        results.push({platform, generation, mode, video, missed, sender, width: card.w, height: card.h, title: card.text.title, subtitle: card.text.sub,
          action: card.action, ticks, fits: textCalls.every(t => t.left >= card.inset && t.right <= card.w - card.inset && t.y < card.h),
          noOverlap: textCalls[1].right + 20 < textCalls[2].left});
      }
    }
    state.generation = 'classic';
    const classic = buildBlocks(previewCtx, getPlatformTokens(), 1, false, MAX_TEXT_W).blocks.filter(b => b.type === 'bubble').length;
    return {results, classic};
  });
  expect(results.results).toHaveLength(64);
  for (const row of results.results){
    expect(row.fits, JSON.stringify(row)).toBe(true);
    expect(row.noOverlap, JSON.stringify(row)).toBe(true);
    expect(row.ticks).toBe(0);
    expect(!!row.action).toBe(row.generation === 'current' && row.missed && row.sender === 'me');
    expect(row.title.startsWith('Missed')).toBe(row.missed && row.sender === 'contact');
    if (row.missed) expect(row.subtitle).toBe(row.sender === 'me' ? 'No answer' : 'Tap to call back');
  }
  expect(results.classic).toBe(0);
  const sheets = await page.evaluate(() => {
    const sheets = {};
    for (const mode of ['light', 'dark']) for (const video of [false, true]) {
      const sheet = document.createElement('canvas'); sheet.width = 864; sheet.height = 1584;
      const s = sheet.getContext('2d'); s.fillStyle = '#cbe0f8'; s.fillRect(0, 0, sheet.width, sheet.height);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        state.platform = ['android', 'ios'][col]; state.generation = ['refreshed', 'current'][row];
        state.theme.chromeMode = mode; state.theme.bubbleColorMe = BUBBLE_DEFAULTS[mode].me; state.theme.bubbleColorContact = BUBBLE_DEFAULTS[mode].contact;
        state.theme.bubbleMeCustomized = false; state.theme.bubbleContactCustomized = false;
        state.contact.name = 'Alex'; state.statusBar = {...STATUS_BAR_DEFAULTS, clockMode: 'fixed', fixedTime: '03:45'};
        state.messages = [
          {sender: 'contact', missed: false, sec: 14}, {sender: 'me', missed: false, sec: 34},
          {sender: 'contact', missed: true, sec: 0}, {sender: 'me', missed: true, sec: 0}
        ].map((item, i) => ({id: uid(), sender: item.sender, date: today(), time: '03:' + (40 + i), text: '', deleted: false, status: 'read', media: null, replyTo: null, call: {video, missed: item.missed, h: 0, min: 0, sec: item.sec}}));
        previewState.revealedCount = 4; chatScroll.followLatest = false; chatScroll.target = 0; scrollOffsetCurrent = 0;
        draw(previewCtx, performance.now());
        s.fillStyle = '#09172e'; s.font = '14px Arial'; s.fillText(`${state.platform} / ${state.generation} / ${mode}`, col * 432 + 10, row * 792 + 18);
        s.drawImage(previewCanvas, col * 432, row * 792 + 24, 432, 768);
      }
      sheets[`${video ? 'video' : 'voice'}-${mode}`] = sheet.toDataURL();
    }
    return sheets;
  });
  for (const [name, data] of Object.entries(sheets)) {
    const path = testInfo.outputPath(name + '.png');
    fs.writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'));
    await testInfo.attach(name, {path, contentType: 'image/png'});
  }
  expect(errors).toEqual([]);
});

test('call controls and preview fit desktop, tablet and mobile', async ({ page, browser }, testInfo) => {
  await openStudio(page);
  await page.evaluate(() => {
    state.messages = [{id: uid(), sender: 'me', date: today(), time: '03:45', text: '', deleted: false, status: 'read', media: null, call: {video: true, missed: false, h: 0, min: 0, sec: 14}}];
    previewState.revealedCount = 1; renderMessageList();
  });
  for (const width of [1500, 768, 390, 360]) {
    await page.setViewportSize({width, height: 900});
    if (width < 1200) await page.locator('.tabsBar [data-tab="content"]').click();
    await expect(page.getByRole('spinbutton', {name: 'Call seconds', exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => [previewCanvas.width, previewCanvas.height])).toEqual([1080, 1920]);
  }
  const data = await page.evaluate(() => serializeProjectData());
  const context = await browser.newContext({baseURL: testInfo.project.use.baseURL, viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true});
  try {
    const mobile = await context.newPage();
    await openStudio(mobile);
    await mobile.evaluate(data => {Object.assign(state, deserializeProjectData(data)); syncUIFromState(); previewState.revealedCount = 1;}, data);
    for (const platform of ['ios', 'android']) {
      await mobile.evaluate(platform => {state.platform = platform; draw(previewCtx, performance.now());}, platform);
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mobile.locator('#previewCanvas').scrollIntoViewIfNeeded();
      await mobile.locator('.phone-frame').screenshot({path: testInfo.outputPath('mobile-3x-' + platform + '.png')});
    }
  } finally { await context.close(); }
});
