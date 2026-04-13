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
- Docker + docker-compose + Cloudflare tunnel config.

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

## Cloudflare tunnel (domain access)

1. Create a Cloudflare tunnel and DNS route in Cloudflare.
2. Put the tunnel credentials JSON file in `cloudflared/` and update `cloudflared/config.yml`:
   - `tunnel`
   - `credentials-file`
   - `hostname`
3. Start:

```bash
docker compose up --build
```

The game is then available through your configured hostname over HTTPS/WSS via Cloudflare.

## Verification checklist

- Open multiple browser sessions and confirm joins/leaves and synced movement.
- Confirm websocket uses same-origin secure transport when served via domain.
- Restart a client and confirm reconnect behavior within stale timeout window.
- Validate container health and app reachability through `/healthz`.
- With several players, confirm the server tick remains stable.

## License

MIT
