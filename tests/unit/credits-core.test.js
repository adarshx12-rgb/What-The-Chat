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
});
