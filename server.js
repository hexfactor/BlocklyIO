var finalhandler = require("finalhandler");
var http = require("http");
var serveStatic = require("serve-static");
var socketIo = require("socket.io");

var Game = require("./game-server");
var protocol = require("./protocol");

function envInt(name, fallback, min, max) {
  var raw = process.env[name];
  if (raw === undefined) return fallback;
  var parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  if (min !== undefined && parsed < min) return fallback;
  if (max !== undefined && parsed > max) return fallback;
  return parsed;
}

function envStr(name, fallback) {
  var raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function log(msg) {
  console.log("[" + new Date() + "] " + msg);
}

var config = {
  host: envStr("HOST", process.argv[2] || "0.0.0.0"),
  port: envInt("PORT", parseInt(process.argv[3], 10) || 8080, 1, 65535),
  tickRate: envInt("TICK_RATE", 60, 1, 240),
  roomMaxPlayers: envInt("ROOM_MAX_PLAYERS", 24, 1, 500),
  maxRooms: envInt("MAX_ROOMS", 32, 1, 1000),
  staleTimeoutMs: envInt("STALE_TIMEOUT_MS", 10000, 1000, 300000),
  maxPayloadBytes: envInt("MAX_PAYLOAD_BYTES", 65536, 1024, 1000000),
  rateLimitWindowMs: envInt("RATE_LIMIT_WINDOW_MS", 1000, 100, 60000),
  rateLimitEvents: envInt("RATE_LIMIT_EVENTS", 120, 1, 5000),
  allowedOrigins: envStr("ALLOWED_ORIGINS", "").split(",").map(function(v) { return v.trim(); }).filter(Boolean)
};

var serve = serveStatic("public/", { setHeaders: setHeaders });

function setHeaders(res) {
  res.setHeader("Cache-Control", "public, max-age=0");
}

function onRequest(req, res) {
  if (req.url === "/healthz") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  serve(req, res, finalhandler(req, res));
}

var server = http.createServer(onRequest);

function isAllowedOrigin(origin) {
  if (config.allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return config.allowedOrigins.indexOf(origin) !== -1;
}

var io = socketIo(server, {
  transports: ["websocket"],
  serveClient: false,
  maxHttpBufferSize: config.maxPayloadBytes,
  allowRequest: function(req, cb) {
    var origin = req.headers && req.headers.origin;
    cb(null, isAllowedOrigin(origin));
  }
});

var rooms = new Map();
var nextRoomId = 1;

function getOrCreateRoom(roomId) {
  var room = roomId ? rooms.get(roomId) : null;
  if (room) return room;
  if (rooms.size >= config.maxRooms) return null;
  var id = roomId || ("room-" + nextRoomId++);
  room = new Game(id, {
    maxPlayers: config.roomMaxPlayers,
    staleTimeoutMs: config.staleTimeoutMs
  });
  rooms.set(id, room);
  return room;
}

function findJoinableRoom() {
  for (var room of rooms.values()) {
    if (!room.isFull()) return room;
  }
  return getOrCreateRoom();
}

function cleanupEmptyRooms() {
  for (var pair of rooms.entries()) {
    var roomId = pair[0];
    var room = pair[1];
    if (room.isEmpty()) rooms.delete(roomId);
  }
}

function validateHello(data) {
  if (!data || typeof data !== "object") {
    return "Missing hello payload.";
  }
  if (data.protocol !== protocol.VERSION) {
    return "Protocol mismatch.";
  }
  if (data.name && (typeof data.name !== "string" || data.name.length > 32)) {
    return "Your name is too long!";
  }
  if (data.roomId && (typeof data.roomId !== "string" || data.roomId.length > 128)) {
    return "Invalid room id.";
  }
  if (data.reconnectToken && (typeof data.reconnectToken !== "string" || data.reconnectToken.length > 128)) {
    return "Invalid reconnect token.";
  }
  return null;
}

function attachRateLimit(socket) {
  var events = 0;
  var windowStarted = Date.now();
  socket.use(function(packet, next) {
    var now = Date.now();
    if (now - windowStarted >= config.rateLimitWindowMs) {
      windowStarted = now;
      events = 0;
    }
    events++;
    if (events > config.rateLimitEvents) {
      next(new Error("Rate limit exceeded"));
      socket.disconnect(true);
      return;
    }
    try {
      var size = Buffer.byteLength(JSON.stringify(packet), "utf8");
      if (size > config.maxPayloadBytes) {
        next(new Error("Payload too large"));
        socket.disconnect(true);
        return;
      }
    } catch (err) {
      next(new Error("Invalid packet"));
      socket.disconnect(true);
      return;
    }
    next();
  });
}

io.on("connection", function(socket) {
  attachRateLimit(socket);

  socket.on(protocol.EVENTS.HELLO, function(data, fn) {
    if (typeof fn !== "function") {
      fn = function() {};
    }

    var invalidReason = validateHello(data);
    if (invalidReason) {
      fn(false, invalidReason);
      return;
    }

    var room = null;
    var joinResult = null;
    var roomId = data.roomId;

    if (data.reconnectToken) {
      var roomEntries = roomId ? [[roomId, rooms.get(roomId)]] : Array.from(rooms.entries());
      for (var i = 0; i < roomEntries.length; i++) {
        var foundRoom = roomEntries[i][1];
        if (!foundRoom) continue;
        joinResult = foundRoom.reconnectPlayer(socket, data.reconnectToken, data.name);
        if (joinResult.ok) {
          room = foundRoom;
          break;
        }
      }
      if (!room && roomId) {
        fn(false, "Reconnect session was not found.");
        return;
      }
    }

    if (!room) {
      room = roomId ? getOrCreateRoom(roomId) : findJoinableRoom();
      if (!room) {
        fn(false, "No room capacity available.");
        return;
      }
      joinResult = room.addPlayer(socket, data.name, data.reconnectToken);
      if (!joinResult.ok) {
        fn(false, joinResult.reason);
        return;
      }
    }

    socket.data = socket.data || {};
    socket.data.roomId = room.id;
    socket.data.playerNum = joinResult.player.num;

    fn(true, null, {
      protocol: protocol.VERSION,
      roomId: room.id,
      reconnectToken: joinResult.player.reconnectToken,
      reconnectWindowMs: config.staleTimeoutMs
    });
  });

  socket.on(protocol.EVENTS.CHECK_CONN, function(fn) {
    if (typeof fn === "function") {
      fn({
        ok: true,
        protocol: protocol.VERSION
      });
    }
  });
});

server.listen(config.port, config.host, function() {
  log("Listening on " + config.host + ":" + config.port);
});

function tick() {
  for (var room of rooms.values()) {
    room.tickFrame();
  }
  cleanupEmptyRooms();
  setTimeout(tick, 1000 / config.tickRate);
}
tick();
