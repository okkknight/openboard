# OpenBoard remote MCP

OpenBoard can run as one cloud process that owns the durable Scene and serves both the visual canvas and MCP over HTTP. Every MCP client then connects to the same runtime; no client starts a second Node process and no SSH tunnel is required for the normal deployment.

## Runtime modes

- Local development keeps the default `OPENBOARD_MCP_TRANSPORT=stdio` mode.
- Shared deployment sets `OPENBOARD_MCP_TRANSPORT=http` and exposes `OPENBOARD_MCP_PATH` (default `/mcp`).
- HTTP mode requires `OPENBOARD_MCP_TOKEN`. Requests must send `Authorization: Bearer <token>`.

The web canvas is served by the same process. Its `/ws` connection and the `/mcp` endpoint therefore observe the same scene revision, work session, streamed render artifacts, and persistence directory.

## Server setup

```sh
mkdir -p ~/.config/openboard
cp deploy/openboard.env.example ~/.config/openboard/openboard.env
chmod 600 ~/.config/openboard/openboard.env
# Replace OPENBOARD_MCP_TOKEN with a long random value.
npm ci
npm run build
systemctl --user daemon-reload
systemctl --user enable --now openboard.service
```

Use [deploy/Caddyfile.openboard.example](../deploy/Caddyfile.openboard.example) for a dedicated host, or [deploy/boringmax-openboard.caddy](../deploy/boringmax-openboard.caddy) when mounting beneath an existing Caddy site. For the latter, set `OPENBOARD_BASE_PATH=/openboard`; the canvas then generates its asset, API, and WebSocket URLs under that prefix.

```text
https://openboard.example.com/       # visual canvas
https://openboard.example.com/mcp   # standard Streamable HTTP MCP
```

The deployed `boringmax.com` shape is:

```text
https://boringmax.com/openboard/       # visual canvas
https://boringmax.com/openboard/mcp    # standard Streamable HTTP MCP
```

Caddy must proxy `/ws` with WebSocket upgrade support. Do not expose the Node port directly to the Internet and do not run a second MCP process beside the web process.

OpenBoard's browser modules currently use stable asset URLs. Its Caddy route must therefore set `Cache-Control: no-store, max-age=0` for the mounted OpenBoard path, as in the supplied Caddy snippets; otherwise a browser can retain an older renderer after a deploy.

When deploying source updates, exclude `.datacanvas/` from synchronization. It is cloud runtime state, not build output; copying a local scene can import local-only dataset paths and prevent the cloud service from starting.

## Agent configuration

Any MCP client that supports Streamable HTTP can use the same endpoint. The generic shape is:

```json
{
  "mcpServers": {
    "openboard": {
      "url": "https://openboard.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${OPENBOARD_MCP_TOKEN}"
      }
    }
  }
}
```

The exact config key for environment-backed headers varies by agent; the transport contract does not. The client should send `Accept: application/json, text/event-stream` and `Content-Type: application/json` for JSON-RPC requests.

## Deployment checks

```sh
curl -fsS https://openboard.example.com/healthz
curl -i -X POST https://openboard.example.com/mcp \
  -H 'Authorization: Bearer <token>' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1"}}}'
```

Acceptance is not just an HTTP 200: initialize must return `serverInfo.name = openboard`, `tools/list` must expose the OpenBoard tool surface, the browser must stay connected over `/ws`, and a visual created through MCP must appear in that browser without a restart.
