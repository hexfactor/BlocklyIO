const test = require("node:test");
const assert = require("node:assert/strict");
const io = require("socket.io-client");

const protocol = require("../protocol");
const { spawnServer, stopServer, waitForHealth } = require("./helpers/server-control");

let instance;

function connectClient(wsUrl, extraHeaders) {
  return new Promise((resolve, reject) => {
    const socket = io(wsUrl, {
      transports: ["websocket"],
      forceNew: true,
      timeout: 3000,
      extraHeaders: extraHeaders || {}
    });

    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(err));
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, function() {
      resolve(Array.prototype.slice.call(arguments));
    });
  });
}

test.before(async function() {
  instance = spawnServer();
  await waitForHealth(instance.port);
});

test.after(async function() {
  await stopServer(instance.child);
});

test("checkConn returns protocol/version response", async function() {
  const socket = await connectClient(instance.wsUrl);
  const response = await new Promise((resolve) => {
    socket.emit(protocol.EVENTS.CHECK_CONN, resolve);
  });

  assert.equal(response.ok, true);
  assert.equal(response.protocol, protocol.VERSION);
  socket.disconnect();
});

test("hello joins successfully and returns reconnect metadata", async function() {
  const socket = await connectClient(instance.wsUrl);
  const [ok, msg, data] = await emitAck(socket, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "test-player",
    roomId: "room-test-a"
  });

  assert.equal(ok, true);
  assert.equal(msg, null);
  assert.equal(data.protocol, protocol.VERSION);
  assert.equal(data.roomId, "room-test-a");
  assert.equal(typeof data.reconnectToken, "string");
  assert.ok(data.reconnectToken.length > 0);
  socket.disconnect();
});

test("hello rejects protocol mismatches", async function() {
  const socket = await connectClient(instance.wsUrl);
  const [ok, message] = await emitAck(socket, protocol.EVENTS.HELLO, {
    protocol: 999,
    name: "bad-protocol"
  });

  assert.equal(ok, false);
  assert.equal(message, "Protocol mismatch.");
  socket.disconnect();
});

test("hello rejects long names", async function() {
  const socket = await connectClient(instance.wsUrl);
  const [ok, message] = await emitAck(socket, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "x".repeat(33)
  });

  assert.equal(ok, false);
  assert.equal(message, "Your name is too long!");
  socket.disconnect();
});
