const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../../app/index.html"), "utf8");
const start = html.indexOf("async function convertViaMp4Backend(blob){");
const end = html.indexOf("function pickMimeType(){", start);
assert.ok(start >= 0 && end > start);
const source = html.slice(start, end);

function converter(response) {
  return vm.runInNewContext(`${source}\nconvertViaMp4Backend`, {
    FormData, fetch: async () => response,
  });
}

test("recorder surfaces retry seconds from HTTP 429 without retrying the upload", async () => {
  for (const [header, expected] of [["60", 60], ["", null], ["invalid", null], ["-2", null]]) {
    const convert = converter(new Response("", { status: 429, headers: { "Retry-After": header } }));
    await assert.rejects(convert(new Blob(["recording"])), (error) => {
      assert.equal(error.code, "rate_limit_exceeded");
      assert.equal(error.retryAfter, expected);
      return true;
    });
  }
});

test("recorder still accepts successful conversions and rejects other server failures", async () => {
  const convert = converter(new Response("converted", { headers: { "Content-Type": "video/mp4" } }));
  assert.equal(await (await convert(new Blob(["recording"]))).text(), "converted");
  await assert.rejects(converter(new Response("", { status: 500 }))(new Blob(["recording"])), /convert failed: 500/);
});

test("recorder inline JavaScript parses", () => {
  let scripts = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|\btype\s*=/i.test(match[1])) continue;
    new vm.Script(match[2]);
    scripts++;
  }
  assert.ok(scripts > 0);
});
