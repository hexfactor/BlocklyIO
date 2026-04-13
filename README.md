# Blockly.IO

Multiplayer Paper.IO-style game server/client using Socket.IO websocket transport.

## What changed

- Single network entrypoint: static files + websocket traffic now share one HTTP server/port.
- Same-origin client websocket connection (no hardcoded `:8081`/`http://`).
- Versioned protocol handshake (`protocol.js`) for join/check/frame/game/death flow.
- Reconnect session token + stale client timeout window.
- Multi-room matchmaking and lifecycle cleanup.
- Environment-driven runtime configuration.
- Basic socket payload and per-connection event rate limits.
- Docker + docker-compose deployment support.

## Local development

```bash
npm install
npm run build
npm start
```

Open `http://localhost:8080`.

## Environment variables

- `HOST` (default `0.0.0.0`)
- `PORT` (default `8080`)
- `TICK_RATE` (default `60`)
- `ROOM_MAX_PLAYERS` (default `24`)
- `MAX_ROOMS` (default `32`)
- `STALE_TIMEOUT_MS` (default `10000`)
- `MAX_PAYLOAD_BYTES` (default `65536`)
- `RATE_LIMIT_WINDOW_MS` (default `1000`)
- `RATE_LIMIT_EVENTS` (default `120`)
- `ALLOWED_ORIGINS` (comma-separated exact origins, default allow all)

## Docker

Build and run:

```bash
docker build -t blocklyio .
docker run --rm -p 8080:8080 -e PORT=8080 blocklyio
```

Health endpoint:

```bash
curl http://localhost:8080/healthz
```

## Cloudflare / domain routing

Cloudflare is intentionally not built into the default compose stack. Run only BlocklyIO:

```bash
docker compose up --build
```

Then point your Cloudflare Tunnel, reverse proxy, or DNS/routing setup at the exposed BlocklyIO app port (`8080` by default). Because the client uses same-origin websocket connections, HTTPS pages through your domain will negotiate WSS correctly as long as your proxy forwards websocket upgrades to the app.

## Verification checklist

- Open multiple browser sessions and confirm joins/leaves and synced movement.
- Confirm websocket uses same-origin secure transport when served via domain.
- Restart a client and confirm reconnect behavior within stale timeout window.
- Validate container health and app reachability through `/healthz`.
- With several players, confirm the server tick remains stable.

## License

MIT
