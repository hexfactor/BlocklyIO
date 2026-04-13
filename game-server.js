var crypto = require("crypto");
var core = require("./game-core");
var protocol = require("./protocol");

var GRID_SIZE = core.GRID_SIZE;
var CELL_WIDTH = core.CELL_WIDTH;
var MAX_PLAYERS = core.MAX_PLAYERS;

var HUES = [0, 10, 20, 25, 30, 35, 40, 45, 50, 60, 70, 100, 110, 120, 125, 130, 135, 140, 145, 150, 160, 170, 180, 190, 200, 210, 220].map(function(val) { return val / 240; });
var SATS = [192, 150, 100].map(function(val) { return val / 240; });

function log(msg) {
  console.log("[" + new Date() + "] " + msg);
}

function Game(id, options) {
  options = options || {};

  var staleTimeoutMs = options.staleTimeoutMs || 10000;
  var maxPlayers = options.maxPlayers || MAX_PLAYERS;

  var possColors = new Array(SATS.length * HUES.length);
  var i = 0;
  for (var s = 0; s < SATS.length; s++) {
    for (var h = 0; h < HUES.length; h++) {
      possColors[i++] = new core.Color(HUES[h], SATS[s], 0.5, 1);
    }
  }

  for (i = 0; i < possColors.length * 50; i++) {
    var a = Math.floor(Math.random() * possColors.length);
    var b = Math.floor(Math.random() * possColors.length);
    var tmp = possColors[a];
    possColors[a] = possColors[b];
    possColors[b] = tmp;
  }

  var nextInd = 0;
  var players = [];
  var newPlayers = [];
  var frameLocs = [];
  var frame = 0;

  var filled = 0;
  var grid = new core.Grid(GRID_SIZE, function(row, col, before, after) {
    if (!!after ^ !!before) {
      if (after) filled++;
      else filled--;
      if (filled === GRID_SIZE * GRID_SIZE) log("FULL GAME");
    }
  });

  this.id = id;
  this.maxPlayers = maxPlayers;
  this.staleTimeoutMs = staleTimeoutMs;

  this.isFull = function() {
    return players.length >= maxPlayers;
  };

  this.isEmpty = function() {
    return players.length === 0;
  };

  this.playerCount = function() {
    return players.length;
  };

  this.addPlayer = function(client, name, reconnectToken) {
    if (this.isFull()) {
      return { ok: false, reason: "Game is too full!" };
    }

    var start = findEmpty(grid);
    if (!start) {
      return { ok: false, reason: "No room available in this match." };
    }

    var token = reconnectToken || crypto.randomBytes(16).toString("hex");
    var params = {
      posX: start.col * CELL_WIDTH,
      posY: start.row * CELL_WIDTH,
      currentHeading: Math.floor(Math.random() * 4),
      name: name,
      num: nextInd,
      base: possColors.shift()
    };

    var p = new core.Player(grid, params);
    p.tmpHeading = params.currentHeading;
    p.client = client;
    p.reconnectToken = token;
    p.disconnected = false;
    p.disconnectedAt = 0;
    p.leftAnnounced = false;
    p.frame = -1;

    players.push(p);
    newPlayers.push(p);
    nextInd++;
    core.initPlayer(grid, p);

    attachClientHandlers(p, client);

    if (p.name.indexOf("BOT") === -1) {
      log((p.name || "Unnamed") + " (" + p.num + ") joined room " + id + ".");
    }
    return { ok: true, player: p };
  };

  this.reconnectPlayer = function(client, reconnectToken, providedName) {
    if (!reconnectToken) {
      return { ok: false, reason: "Missing reconnect token." };
    }

    var player = players.find(function(p) {
      return p.reconnectToken === reconnectToken;
    });

    if (!player || player.dead) {
      return { ok: false, reason: "Reconnect session was not found." };
    }

    if (!player.disconnected) {
      return { ok: false, reason: "Reconnect session is already active." };
    }

    if (Date.now() - player.disconnectedAt > staleTimeoutMs) {
      return { ok: false, reason: "Reconnect window has expired." };
    }

    player.disconnected = false;
    player.disconnectedAt = 0;
    player.leftAnnounced = false;
    if (providedName && typeof providedName === "string" && providedName.length <= 32) {
      player.name = providedName;
    }
    player.client = client;
    attachClientHandlers(player, client);

    if (player.name.indexOf("BOT") === -1) {
      log((player.name || "Unnamed") + " (" + player.num + ") reconnected to room " + id + ".");
    }
    return { ok: true, player: player };
  };

  this.tickFrame = function() {
    var currentPlayers = players.slice();
    var splayers = currentPlayers.map(function(val) { return val.serialData(); });
    var snews = newPlayers.map(function(val) {
      if (!val.disconnected && val.client && val.client.connected) {
        val.client.emit(protocol.EVENTS.GAME_STATE, {
          protocol: protocol.VERSION,
          num: val.num,
          gameid: id,
          roomId: id,
          frame: frame,
          players: splayers,
          grid: gridSerialData(grid, currentPlayers),
          session: {
            reconnectToken: val.reconnectToken,
            reconnectWindowMs: staleTimeoutMs
          }
        });
      }
      return val.serialData();
    });

    var now = Date.now();
    var moves = currentPlayers.map(function(val) {
      val.heading = val.tmpHeading;
      if (val.disconnected && now - val.disconnectedAt > staleTimeoutMs) {
        val.stale = true;
      }
      return {
        num: val.num,
        left: !!val.stale,
        heading: val.heading
      };
    });

    update();

    var data = {
      protocol: protocol.VERSION,
      frame: frame + 1,
      roomId: id,
      moves: moves
    };
    if (snews.length > 0) {
      data.newPlayers = snews;
      newPlayers = [];
    }

    for (var idx = 0; idx < players.length; idx++) {
      var pl = players[idx];
      if (pl.disconnected || !pl.client || !pl.client.connected) continue;
      pl.client.emit(protocol.EVENTS.FRAME_NOTIFY, data);
    }

    frame++;
    pushPlayerLocations();
  };

  function attachClientHandlers(player, client) {
    client.removeAllListeners(protocol.EVENTS.REQUEST_FRAME);
    client.removeAllListeners(protocol.EVENTS.VERIFY);
    client.removeAllListeners(protocol.EVENTS.FRAME_INPUT);
    client.removeAllListeners("disconnect");

    client.on(protocol.EVENTS.REQUEST_FRAME, function() {
      if (player.frame === frame || player.disconnected) {
        return;
      }
      player.frame = frame;

      var splayers = players.map(function(val) { return val.serialData(); });
      client.emit(protocol.EVENTS.GAME_STATE, {
        protocol: protocol.VERSION,
        num: player.num,
        gameid: id,
        roomId: id,
        frame: frame,
        players: splayers,
        grid: gridSerialData(grid, players),
        session: {
          reconnectToken: player.reconnectToken,
          reconnectWindowMs: staleTimeoutMs
        }
      });
    });

    client.on(protocol.EVENTS.VERIFY, function(data, resp) {
      if (typeof resp !== "function") return;

      if (!data || data.frame === undefined) resp(false, false, "No frame supplied");
      else if (!checkInt(data.frame, 0, frame + 1)) resp(false, false, "Must be a valid frame number");
      else verifyPlayerLocations(data.frame, data.locs, resp);
    });

    client.on(protocol.EVENTS.FRAME_INPUT, function(data, errorHan) {
      if (typeof data === "function") {
        errorHan(false, "No data supplied.");
        return;
      }

      if (typeof errorHan !== "function") {
        errorHan = function() {};
      }

      if (!data) {
        errorHan(false, "No data supplied.");
      } else if (!checkInt(data.frame, 0, Infinity)) {
        errorHan(false, "Requires a valid non-negative frame integer.");
      } else if (data.frame > frame) {
        errorHan(false, "Invalid frame received.");
      } else if (data.heading !== undefined) {
        if (checkInt(data.heading, 0, 4)) {
          player.tmpHeading = data.heading;
          errorHan(true);
        } else {
          errorHan(false, "New heading must be an integer of range [0, 4).");
        }
      }
    });

    client.on("disconnect", function() {
      player.disconnected = true;
      player.disconnectedAt = Date.now();
      if (!player.leftAnnounced && player.name.indexOf("BOT") === -1) {
        log((player.name || "Unnamed") + " (" + player.num + ") disconnected from room " + id + ".");
        player.leftAnnounced = true;
      }
    });
  }

  function pushPlayerLocations() {
    var locs = [];
    for (var idx = 0; idx < players.length; idx++) {
      var p = players[idx];
      locs[p.num] = [p.posX, p.posY, p.waitLag];
    }
    locs.frame = frame;

    if (frameLocs.length >= 300) frameLocs.shift();
    frameLocs.push(locs);
  }

  function verifyPlayerLocations(fr, verify, resp) {
    var minFrame = frame - frameLocs.length + 1;
    if (fr < minFrame || fr > frame) {
      resp(false, false, "Frames out of reference");
      return;
    }

    function string(loc) {
      return "(" + loc[0] + ", " + loc[1] + ") [" + loc[2] + "]";
    }

    var locs = frameLocs[fr - minFrame];
    if (locs.frame !== fr) {
      resp(false, false, locs.frame + " != " + fr);
      return;
    }

    for (var num in verify) {
      if (!locs[num]) continue;
      if (locs[num][0] !== verify[num][0] || locs[num][1] !== verify[num][1] || locs[num][2] !== verify[num][2]) {
        resp(false, true, "P" + num + " " + string(locs[num]) + " !== " + string(verify[num]));
        return;
      }
    }

    resp(true, false);
  }

  function update() {
    var dead = [];
    core.updateFrame(grid, players, dead);
    var alive = [];

    for (var idx = 0; idx < players.length; idx++) {
      var pl = players[idx];

      if (pl.stale && !pl.dead) {
        pl.die();
        dead.push(pl);
      }

      if (!pl.dead) {
        alive.push(pl);
      }
    }

    for (idx = 0; idx < dead.length; idx++) {
      pl = dead[idx];
      if (!pl.handledDead) {
        possColors.push(pl.baseColor);
        pl.handledDead = true;
      }
      if (pl.name.indexOf("BOT") === -1) {
        log((pl.name || "Unnamed") + " (" + pl.num + ") left room " + id + ".");
      }
      if (pl.client && pl.client.connected) {
        pl.client.emit(protocol.EVENTS.DEAD);
        pl.client.disconnect(true);
      }
    }

    players = alive;
  }
}

function checkInt(value, min, max) {
  if (typeof value !== "number") return false;
  if (value < min || value >= max) return false;
  if (Math.floor(value) !== value) return false;
  return true;
}

function gridSerialData(grid, players) {
  var buff = Buffer.alloc(grid.size * grid.size);

  var numToIndex = new Array(players.length > 0 ? players[players.length - 1].num + 1 : 0);
  for (var i = 0; i < players.length; i++) numToIndex[players[i].num] = i + 1;

  for (var r = 0; r < grid.size; r++) {
    for (var c = 0; c < grid.size; c++) {
      var ele = grid.get(r, c);
      buff[r * grid.size + c] = ele ? numToIndex[ele.num] : 0;
    }
  }
  return buff;
}

function findEmpty(grid) {
  var available = [];

  for (var r = 1; r < grid.size - 1; r++) {
    for (var c = 1; c < grid.size - 1; c++) {
      var cluttered = false;
      checkclutter: for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (grid.get(r + dr, c + dc)) {
            cluttered = true;
            break checkclutter;
          }
        }
      }
      if (!cluttered) available.push({ row: r, col: c });
    }
  }

  if (available.length === 0) return null;
  return available[Math.floor(available.length * Math.random())];
}

module.exports = Game;
