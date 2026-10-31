const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once, EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const express = require("express");
const { sendError, handleError } = require("../errors");

const generic = { error: "Something went wrong. Please try again later." };
const uploadError = { error: "Unable to process this upload. Please select a video and try again." };
const secret = "INTERNAL_SENTINEL C:/private/service/credentials.js database-password";

async function listen(app, t) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function upload() {
  const form = new FormData();
  form.append("video", new Blob(["invalid video"]), "test.webm");
  return form;
}

test("unexpected exceptions retain stacks in server logs but expose only a generic 500", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const failure = Object.assign(new Error(secret), { status: 400, expose: true });
  const app = express();
  app.get("/", () => { throw failure; });
  app.use(handleError);
  const url = await listen(app, t);
  const response = await fetch(url);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), generic);
  assert.equal(logs[0][1], failure);
  assert.match(logs[0][1].stack, /INTERNAL_SENTINEL/);
});

test("failure after response headers were sent closes the connection without writing details", () => {
  let closed = false;
  sendError({ headersSent: true, destroy() { closed = true; } });
  assert.equal(closed, true);
});

test("real upload and converter errors stay generic; unknown paths are not reflected", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const url = await listen(require("../server"), t);
  const malformed = await fetch(`${url}/convert`, { method: "POST", headers: {
    "Content-Type": "multipart/form-data",
  }, body: "invalid" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), uploadError);
  assert.ok(logs.some((args) => args.some((arg) => arg instanceof Error && arg.stack)));

  const missing = await fetch(`${url}/convert`, { method: "POST" });
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), uploadError);

  const failed = await fetch(`${url}/convert`, { method: "POST", body: upload() });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), generic);
  assert.ok(logs.some((args) => String(args[0]).includes("ffmpeg exited with code")));
  assert.equal(failed.headers.get("X-Powered-By"), null);

  const unknown = await fetch(`${url}/INTERNAL_SENTINEL`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "Not found." });
});

// Exercise otherwise rare OS/process failures through the actual route, with
// isolated filesystem/process substitutes instead of touching real files.
function failingConverter(scenario, logs) {
  const filename = path.join(__dirname, "../server.js");
  const localRequire = createRequire(filename);
  const failure = new Error(secret);
  const fakeFs = {
    promises: {
      async writeFile() { if (scenario === "write") throw failure; },
      async unlink() {},
      async stat() {
        if (scenario === "stat") throw failure;
        return { size: scenario === "empty" ? 0 : 123456 };
      },
    },
    createReadStream() {
      const stream = new PassThrough();
      process.nextTick(() => stream.destroy(failure));
      return stream;
    },
  };
  const fakeProcess = {
    spawn() {
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      process.nextTick(() => {
        if (scenario === "spawn") child.emit("error", failure);
        else child.emit("close", 0);
      });
      return child;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module,
    require(id) {
      if (id === "fs") return fakeFs;
      if (id === "child_process") return fakeProcess;
      if (id === "ffmpeg-static" && scenario === "binary") return null;
      return localRequire(id);
    },
    console: { error: (...args) => logs.push(args) },
  }, { filename });
  return module.exports;
}

for (const scenario of ["binary", "write", "spawn", "stat", "empty", "stream"]) {
  test(`${scenario} failure returns generic JSON and retains server diagnostics`, async (t) => {
    const logs = [];
    const url = await listen(failingConverter(scenario, logs), t);
    const response = await fetch(`${url}/convert`, { method: "POST", body: upload() });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), generic);
    assert.match(response.headers.get("Content-Type"), /application\/json/);
    assert.equal(response.headers.get("Content-Disposition"), null);
    assert.notEqual(response.headers.get("Content-Length"), "123456");
    assert.ok(logs.length > 0);
    if (!["binary", "empty"].includes(scenario)) {
      assert.ok(logs.some((args) => args.some((arg) => arg instanceof Error && arg.stack.includes(secret))));
    }
  });
}
