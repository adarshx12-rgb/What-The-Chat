const fs = require('node:fs');
const { PNG } = require('pngjs');
const { test, expect, openStudio, setProfile } = require('./fixtures');

async function saveShot(page){
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#screenshotBtn')]);
  return PNG.sync.read(fs.readFileSync(await download.path()));
}

function diffCounts(a, b, box){
  let inside = 0, outside = 0;
  for (let y = 0; y < a.height; y++){
    for (let x = 0; x < a.width; x++){
      const i = (y * a.width + x) * 4;
      const differs = Math.abs(a.data[i] - b.data[i]) > 8 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 8;
      if (!differs) continue;
      const inBox = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      if (inBox) inside++; else outside++;
    }
  }
  return { inside, outside };
}

test('a screenshot costs 1 credit and is clean; at 0 credits it is watermarked', async ({ page }) => {
  await openStudio(page);
  const clean = await saveShot(page);
  expect(clean.width).toBe(1080);
  expect(clean.height).toBe(1920);
  expect(await page.evaluate(() => WTCCredits.get().credits)).toBe(19);

  await setProfile(page, { credits: 0 });
  const marked = await saveShot(page);
  const box = await page.evaluate(() => WATERMARK_BOX);
  const { inside, outside } = diffCounts(clean, marked, box);
  expect(inside).toBeGreaterThan(5000);
  expect(outside).toBeLessThan(200);
  // The backing pill must be drawn (not just the text): a point inside the
  // pill, left of the text, is clearly darker than in the clean frame.
  const lum = (png, x, y) => { const i = (y * png.width + x) * 4; return (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; };
  const px = box.x + 24, py = box.y + Math.round(box.h / 2);
  expect(lum(marked, px, py)).toBeLessThan(lum(clean, px, py) - 60);
  await expect(page.locator('#toastRegion')).toContainText('watermark');
});

test('the live preview is not watermarked outside exports', async ({ page }) => {
  await openStudio(page);
  await setProfile(page, { credits: 0 });
  expect(await page.evaluate(() => exportWatermarkActive(performance.now()))).toBe(false);
});
