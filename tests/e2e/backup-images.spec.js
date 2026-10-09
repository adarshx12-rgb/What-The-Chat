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

test('imported backups are rebuilt from a whitelist with caps and safe defaults', async ({ page }) => {
  await page.route('**/assets/credits-config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.WTC_CONFIG = {};' }));
  await page.goto('/app/index.html');
  const d = await page.evaluate(() => {
    const out = deserializeProjectData({
      contact: { name: 'x'.repeat(5000), statusMode: '<img onerror=alert(1)>', extra: 'dropped' },
      theme: { chromeMode: 'neon', bubbleColorMe: 'red;background:url(x)', wallpaperBrightness: 99, __proto__: { polluted: 1 } },
      platform: 'windows', generation: 'future', timeStepEvery: 'abc',
      messages: [
        { id: 'm7', sender: 'robot', text: 'y'.repeat(10000), date: 'tomorrow', time: '25 o clock', status: 'seen', deleted: 'yes', replyTo: { a: 1 } },
        { id: 'm7', sender: 'me', text: 42 },
        'not a message',
        { id: '<script>', sender: 'contact', text: 'ok' },
      ],
      timeline: { m7: -5, other: 100 },
    });
    return { ...out, newId: uid(), msgCount: out.messages.length };
  });
  expect(d.contact.name.length).toBe(100);
  expect(d.contact.statusMode).toBe('online');
  expect(d.contact.extra).toBeUndefined();
  expect(d.theme.chromeMode).toBe('light');
  expect(d.theme.bubbleColorMe).toBe('#d9fdd3');
  expect(d.theme.wallpaperBrightness).toBe(1);
  expect(d.platform).toBe('android');
  expect(d.generation).toBe('classic');
  expect(d.timeStepEvery).toBe(3);
  expect(d.msgCount).toBe(3);
  const [a, b, c] = d.messages;
  expect(a).toMatchObject({ id: 'm7', sender: 'contact', status: 'read', deleted: false, replyTo: null, time: '12:00' });
  expect(a.text.length).toBe(4000);
  expect(b.id).not.toBe('m7'); // duplicate ids get a fresh one
  expect(b.text).toBe('');
  expect(c.id).toMatch(/^m\d+$/); // unsafe ids are replaced
  expect(d.timeline).toEqual({});
  expect(Number(d.newId.slice(1))).toBeGreaterThan(7); // new ids never collide with imported ones
});
