const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const { once } = require("events");

const ROOT = path.resolve(__dirname, "..", "..");

function randomPort() {
  return 10000 + Math.floor(Math.random() * 10000);
}

function spawnServer(overrides = {}) {
  const port = overrides.PORT || String(randomPort());
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: port,
    TICK_RATE: "30",
    ROOM_MAX_PLAYERS: "4",
    MAX_ROOMS: "8",
    STALE_TIMEOUT_MS: "5000",
    RATE_LIMIT_WINDOW_MS: "1000",
    RATE_LIMIT_EVENTS: "200",
    MAX_PAYLOAD_BYTES: "65536",
    ...overrides
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", function() {});
  child.stderr.on("data", function() {});

  return {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    port: Number(port)
  };
}

function get(urlPath, port) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: urlPath
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on("error", reject);
  });
}

async function waitForHealth(port, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await get("/healthz", port);
      if (res.statusCode === 200) {
        return;
      }
    } catch (err) {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("Server did not become healthy in time");
}

async function stopServer(proc) {
  if (!proc || proc.exitCode !== null) return;
  const softExit = once(proc, "exit");
  proc.kill("SIGTERM");
  await Promise.race([softExit, new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (proc.exitCode === null) {
    const hardExit = once(proc, "exit");
    proc.kill("SIGKILL");
    await Promise.race([hardExit, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
}

module.exports = {
  get,
  spawnServer,
  stopServer,
  waitForHealth
};
