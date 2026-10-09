const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../assets/credits-core.js');

test('video cost is 1 credit per started 3 seconds', () => {
  assert.equal(core.videoCost(0), 0);
  assert.equal(core.videoCost(1), 1);
  assert.equal(core.videoCost(3), 1);
  assert.equal(core.videoCost(4), 2);
  assert.equal(core.videoCost(30), 10);
  assert.equal(core.videoCost(600), 200);
});

test('recordingSeconds rounds up and ignores bad input', () => {
  assert.equal(core.recordingSeconds(0), 0);
  assert.equal(core.recordingSeconds(-50), 0);
  assert.equal(core.recordingSeconds(NaN), 0);
  assert.equal(core.recordingSeconds(1), 1);
  assert.equal(core.recordingSeconds(30000), 30);
  assert.equal(core.recordingSeconds(30001), 31);
});

test('coveredMs is credits x 3 s, infinite for pro, 0 when loading', () => {
  assert.equal(core.coveredMs({ credits: 10, pro: false }), 30000);
  assert.equal(core.coveredMs({ credits: 20, pro: false }), 60000);
  assert.equal(core.coveredMs({ credits: 0, pro: false }), 0);
  assert.equal(core.coveredMs({ credits: 0, pro: true }), Infinity);
  assert.equal(core.coveredMs(null), 0);
});

test('watermark starts exactly when recorded time reaches coverage', () => {
  assert.equal(core.watermarkActive(6000, 5999), false);
  assert.equal(core.watermarkActive(6000, 6000), true);
  assert.equal(core.watermarkActive(0, 0), true);
  assert.equal(core.watermarkActive(Infinity, 1e9), false);
});

test('chip label', () => {
  assert.equal(core.chipLabel(null), 'Credits…');
  assert.equal(core.chipLabel({ credits: 0, pro: false, offline: true }), 'Offline');
  assert.equal(core.chipLabel({ credits: 1, pro: false }), '1 credit');
  assert.equal(core.chipLabel({ credits: 20, pro: false }), '20 credits');
  assert.equal(core.chipLabel({ credits: 0, pro: true }), 'Pro');
  assert.equal(core.chipLabel({ credits: 0, pro: true, admin: true }), 'Admin');
});

test('free clean video is capped at 60 s however many credits there are', () => {
  assert.equal(core.FREE_CLEAN_SECONDS, 60);
  assert.equal(core.coveredMs({ credits: 21, pro: false }), 60000);
  assert.equal(core.coveredMs({ credits: 500, pro: false }), 60000);
  assert.equal(core.coveredMs({ credits: 500, pro: true }), Infinity);
  assert.equal(core.hitFreeCap({ credits: 21, pro: false }), true);
  assert.equal(core.hitFreeCap({ credits: 20, pro: false }), false);
  assert.equal(core.hitFreeCap({ credits: 500, pro: true }), false);
  assert.equal(core.hitFreeCap(null), false);
});

test('low-credit warning fires once when the balance drops to 5 or less', () => {
  assert.equal(core.lowCreditWarning({ credits: 10, pro: false }, { credits: 5, pro: false }), 'About 15 s of video left (5 credits).');
  assert.equal(core.lowCreditWarning({ credits: 6, pro: false }, { credits: 1, pro: false }), 'About 3 s of video left (1 credit).');
  assert.equal(core.lowCreditWarning({ credits: 5, pro: false }, { credits: 4, pro: false }), null);
  assert.equal(core.lowCreditWarning({ credits: 10, pro: false }, { credits: 0, pro: false }), null);
  assert.equal(core.lowCreditWarning(null, { credits: 3, pro: false }), null);
  assert.equal(core.lowCreditWarning({ credits: 10, pro: true }, { credits: 3, pro: true }), null);
  assert.equal(core.lowCreditWarning({ credits: 10, pro: false }, { credits: 3, pro: false, offline: true }), null);
});
