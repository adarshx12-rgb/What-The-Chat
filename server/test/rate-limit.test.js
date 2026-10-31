const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const { execFileSync } = require("node:child_process");
const express = require("express");
const { createConversionLimiter } = require("../rate-limit");

function attempt(limiter) {
  const result = { allowed: false, headers: {} };
  const response = {
    setHeader(name, value) { result.headers[name] = value; },
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  limiter({}, response, () => { result.allowed = true; });
  return result;
}

test("six attempts allowed; rejected attempts do not move the rolling window", () => {
  let time = 0;
  const limiter = createConversionLimiter({ now: () => time });
  for (let i = 0; i < 6; i++) assert.equal(attempt(limiter).allowed, true);
  let denied = attempt(limiter);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers["Retry-After"], "60");
  assert.equal(denied.headers["Cache-Control"], "no-store");
  assert.equal(denied.body.code, "rate_limit_exceeded");
  time = 59_001;
  denied = attempt(limiter);
  assert.equal(denied.status, 429);
  assert.equal(denied.body.retryAfter, 1);
  time = 60_000;
  assert.equal(attempt(limiter).allowed, true);
});

test("hourly budget survives minute resets, then expires at the exact boundary", () => {
  let time = 0;
  const limiter = createConversionLimiter({ now: () => time });
  for (let minute = 0; minute < 5; minute++) {
    time = minute * 60_000;
    for (let i = 0; i < 6; i++) assert.equal(attempt(limiter).allowed, true);
  }
  // Both limits are exhausted: report the longer wait.
  assert.equal(attempt(limiter).body.retryAfter, 3360);
  time = 300_000;
  assert.equal(attempt(limiter).body.retryAfter, 3300);
  time = 3_599_999;
  assert.equal(attempt(limiter).body.retryAfter, 1);
  time = 3_600_000;
  for (let i = 0; i < 6; i++) assert.equal(attempt(limiter).allowed, true);
  assert.equal(attempt(limiter).status, 429);
});

test("attempts expire individually rather than resetting at calendar boundaries", () => {
  let time = 0;
  const limiter = createConversionLimiter({ now: () => time });
  assert.equal(attempt(limiter).allowed, true);
  time = 59_000;
  for (let i = 0; i < 5; i++) assert.equal(attempt(limiter).allowed, true);
  assert.equal(attempt(limiter).body.retryAfter, 1);
  time = 60_000;
  assert.equal(attempt(limiter).allowed, true);
  assert.equal(attempt(limiter).body.retryAfter, 59);
});

async function listen(app, t) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("simultaneous requests and forged IP headers cannot bypass the shared budget", async (t) => {
  const app = express();
  let workStarted = 0;
  app.post("/convert", createConversionLimiter(), (req, res) => {
    workStarted++;
    res.json({ ok: true });
  });
  const url = await listen(app, t);
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${url}/convert`, {
    method: "POST",
    headers: { "X-Forwarded-For": `192.0.2.${i}`, "X-Real-IP": `192.0.2.${i}` },
  })));
  assert.equal(responses.filter((r) => r.status === 200).length, 6);
  assert.equal(responses.filter((r) => r.status === 429).length, 14);
  assert.equal(workStarted, 6);
  await Promise.all(responses.map((r) => r.arrayBuffer()));
});

test("real converter works within budget and rejects uploads before parsing once exhausted", async (t) => {
  const app = require("../server");
  const url = await listen(app, t);
  // Health and CORS preflight never consume the conversion budget.
  for (let i = 0; i < 8; i++) {
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/convert`, { method: "OPTIONS", headers: {
      Origin: "https://textingstudio.com", "Access-Control-Request-Method": "POST",
    } })).status, 204);
  }
  const video = execFileSync(require("ffmpeg-static"), [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=1",
    "-t", "1", "-c:v", "libvpx", "-f", "webm", "pipe:1",
  ], { timeout: 15_000, windowsHide: true });
  const form = new FormData();
  form.append("video", new Blob([video], { type: "video/webm" }), "test.webm");
  const converted = await fetch(`${url}/convert`, { method: "POST", body: form });
  assert.equal(converted.status, 200);
  assert.equal(converted.headers.get("Content-Type"), "video/mp4");
  const mp4 = Buffer.from(await converted.arrayBuffer());
  assert.equal(mp4.toString("ascii", 4, 8), "ftyp");
  for (let i = 0; i < 5; i++) {
    const response = await fetch(`${url}/convert`, { method: "POST" });
    assert.equal(response.status, 400); // Invalid attempts also count.
    await response.arrayBuffer();
  }
  // Malformed multipart would return 400 if it reached Multer.
  const denied = await fetch(`${url}/convert`, { method: "POST", headers: {
    "Content-Type": "multipart/form-data", Origin: "https://textingstudio.com",
    "X-Forwarded-For": "203.0.113.1",
  }, body: "malformed upload" });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), "https://textingstudio.com");
  assert.equal(denied.headers.get("Access-Control-Expose-Headers"), "Retry-After");
  const body = await denied.json();
  assert.ok(body.retryAfter > 0 && body.retryAfter <= 60);
  assert.equal(Number(denied.headers.get("Retry-After")), body.retryAfter);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
