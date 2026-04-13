const test = require("node:test");
const assert = require("node:assert/strict");
const io = require("socket.io-client");

const protocol = require("../protocol");
const { spawnServer, stopServer, waitForHealth } = require("./helpers/server-control");

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

test("explicit room joins place players in same room", async function() {
  const instance = spawnServer();
  await waitForHealth(instance.port);
  const s1 = await connectClient(instance.wsUrl);
  const s2 = await connectClient(instance.wsUrl);

  const [, , r1] = await emitAck(s1, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "a1",
    roomId: "shared-room"
  });
  const [, , r2] = await emitAck(s2, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "a2",
    roomId: "shared-room"
  });

  assert.equal(r1.roomId, "shared-room");
  assert.equal(r2.roomId, "shared-room");
  s1.disconnect();
  s2.disconnect();
  await stopServer(instance.child);
});

test("auto matchmaking creates new room when prior room is full", async function() {
  const instance = spawnServer({ ROOM_MAX_PLAYERS: "1" });
  await waitForHealth(instance.port);
  const s1 = await connectClient(instance.wsUrl);
  const s2 = await connectClient(instance.wsUrl);

  const [ok1, , d1] = await emitAck(s1, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "p1"
  });
  const [ok2, , d2] = await emitAck(s2, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "p2"
  });

  assert.equal(ok1, true);
  assert.equal(ok2, true);
  assert.notEqual(d1.roomId, d2.roomId);
  s1.disconnect();
  s2.disconnect();
  await stopServer(instance.child);
});

test("reconnect token allows rejoin to existing room", async function() {
  const instance = spawnServer({ STALE_TIMEOUT_MS: "10000" });
  await waitForHealth(instance.port);
  const s1 = await connectClient(instance.wsUrl);

  const [ok1, , first] = await emitAck(s1, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "rejoin-me",
    roomId: "reconnect-room"
  });
  assert.equal(ok1, true);
  s1.disconnect();

  const s2 = await connectClient(instance.wsUrl);
  const [ok2, err2, second] = await emitAck(s2, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "rejoin-me",
    roomId: "reconnect-room",
    reconnectToken: first.reconnectToken
  });

  assert.equal(ok2, true);
  assert.equal(err2, null);
  assert.equal(second.roomId, "reconnect-room");
  assert.equal(second.reconnectToken, first.reconnectToken);
  s2.disconnect();
  await stopServer(instance.child);
});

test("reconnect with wrong room id is rejected", async function() {
  const instance = spawnServer();
  await waitForHealth(instance.port);
  const s1 = await connectClient(instance.wsUrl);

  const [ok1, , first] = await emitAck(s1, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "reconnect-bad-room",
    roomId: "origin-room"
  });
  assert.equal(ok1, true);
  s1.disconnect();

  const s2 = await connectClient(instance.wsUrl);
  const [ok2, err] = await emitAck(s2, protocol.EVENTS.HELLO, {
    protocol: protocol.VERSION,
    name: "reconnect-bad-room",
    roomId: "different-room",
    reconnectToken: first.reconnectToken
  });

  assert.equal(ok2, false);
  assert.equal(err, "Reconnect session was not found.");
  s2.disconnect();
  await stopServer(instance.child);
});

test("origin allowlist blocks websocket handshake from disallowed origins", async function() {
  const instance = spawnServer({ ALLOWED_ORIGINS: "https://allowed.example" });
  await waitForHealth(instance.port);

  await assert.rejects(
    connectClient(instance.wsUrl, { Origin: "https://blocked.example" }),
    /websocket error|403|forbidden|Unexpected server response/i
  );

  await stopServer(instance.child);
});
