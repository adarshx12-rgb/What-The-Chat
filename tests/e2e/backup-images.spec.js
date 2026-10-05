// Runs without Supabase: imported backups must only bring embedded images.
const { test, expect } = require('@playwright/test');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('imported backups keep data: images and drop remote or script URLs', async ({ page }) => {
  await page.route('**/assets/credits-config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.WTC_CONFIG = {};' }));
  await page.goto('/app/index.html');
  const out = await page.evaluate((png) => {
    const msg = (id, src) => ({ id, sender: 'contact', text: '', media: { type: 'image', img: src } });
    const d = deserializeProjectData({
      contact: { name: 'A', avatarImg: 'https://tracker.example/pixel.png' },
      theme: { wallpaperImg: 'javascript:alert(1)' },
      platform: 'android', generation: 'current',
      messages: [msg('m1', png), msg('m2', 'http://evil.example/x.png'), msg('m3', '//evil.example/x.png')],
    });
    return {
      avatar: d.contact.avatarImg, wallpaper: d.theme.wallpaperImg,
      media: d.messages.map((m) => (m.media && m.media.img ? m.media.img.src.slice(0, 15) : null)),
    };
  }, PNG);
  expect(out.avatar).toBeNull();
  expect(out.wallpaper).toBeNull();
  expect(out.media).toEqual(['data:image/png;', null, null]);
});
