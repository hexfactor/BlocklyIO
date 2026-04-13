const test = require("node:test");
const assert = require("node:assert/strict");

const { get, spawnServer, stopServer, waitForHealth } = require("./helpers/server-control");

let instance;

test.before(async function() {
  instance = spawnServer();
  await waitForHealth(instance.port);
});

test.after(async function() {
  await stopServer(instance.child);
});

test("health endpoint returns ok JSON", async function() {
  const res = await get("/healthz", instance.port);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test("index page is served by static server", async function() {
  const res = await get("/", instance.port);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<title>Blockly\.IO<\/title>/);
});

test("bundle file is served from the same entrypoint", async function() {
  const res = await get("/bundle.js", instance.port);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /javascript|application\/octet-stream/);
  assert.ok(res.body.length > 1000);
});
