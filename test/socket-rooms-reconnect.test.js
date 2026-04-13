const test = require("node:test");
const assert = require("node:assert/strict");
const io = require("socket.io-client");

const protocol = require("../protocol");
const { spawnServer, stopServer, waitForHealth } = require("./helpers/server-control");

function connectClient(wsUrl, extraHeaders) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out connecting websocket client"));
    }, 4000);

    const socket = io(wsUrl, {
      transports: ["websocket"],
      forceNew: true,
      timeout: 3000,
      reconnection: false,
      extraHeaders: extraHeaders || {}
    });

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for ack: " + event)), 4000);
    socket.emit(event, payload, function() {
      clearTimeout(timeout);
      resolve(Array.prototype.slice.call(arguments));
    });
  });
}

async function withServer(overrides, run) {
  const instance = spawnServer(overrides);
  const sockets = [];
  try {
    await waitForHealth(instance.port);
    await run({
      connect: async function(headers) {
        const socket = await connectClient(instance.wsUrl, headers);
        sockets.push(socket);
        return socket;
      }
    });
  } finally {
    for (const socket of sockets) {
      if (socket && socket.connected) {
        socket.disconnect();
      } else if (socket) {
        socket.close();
      }
    }
    await stopServer(instance.child);
  }
}

test("explicit room joins place players in same room", async function() {
  await withServer({}, async function(ctx) {
    const s1 = await ctx.connect();
    const s2 = await ctx.connect();

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
  });
});

test("auto matchmaking creates new room when prior room is full", async function() {
  await withServer({ ROOM_MAX_PLAYERS: "1" }, async function(ctx) {
    const s1 = await ctx.connect();
    const s2 = await ctx.connect();

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
  });
});

test("reconnect token allows rejoin to existing room", async function() {
  await withServer({ STALE_TIMEOUT_MS: "10000" }, async function(ctx) {
    const s1 = await ctx.connect();

    const [ok1, , first] = await emitAck(s1, protocol.EVENTS.HELLO, {
      protocol: protocol.VERSION,
      name: "rejoin-me",
      roomId: "reconnect-room"
    });
    assert.equal(ok1, true);
    s1.disconnect();

    const s2 = await ctx.connect();
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
  });
});

test("reconnect with wrong room id is rejected", async function() {
  await withServer({}, async function(ctx) {
    const s1 = await ctx.connect();

    const [ok1, , first] = await emitAck(s1, protocol.EVENTS.HELLO, {
      protocol: protocol.VERSION,
      name: "reconnect-bad-room",
      roomId: "origin-room"
    });
    assert.equal(ok1, true);
    s1.disconnect();

    const s2 = await ctx.connect();
    const [ok2, err] = await emitAck(s2, protocol.EVENTS.HELLO, {
      protocol: protocol.VERSION,
      name: "reconnect-bad-room",
      roomId: "different-room",
      reconnectToken: first.reconnectToken
    });

    assert.equal(ok2, false);
    assert.equal(err, "Reconnect session was not found.");
  });
});

test("origin allowlist blocks websocket handshake from disallowed origins", async function() {
  await withServer({ ALLOWED_ORIGINS: "https://allowed.example" }, async function(ctx) {
    await assert.rejects(
      ctx.connect({ Origin: "https://blocked.example" }),
      /websocket error|403|forbidden|Unexpected server response/i
    );
  });
});
