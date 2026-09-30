---
"@guardbee/mcp-security-proxy": minor
---

Remote mode: the gateway over Streamable HTTP.

- `listen: { transport: http, host, port, path, apiKeys, maxSessions }` serves the proxy over Streamable HTTP. Each MCP session gets its own taint state, PII tokens and tool pins; all sessions share the upstream connections. Listening beyond loopback without `apiKeys` is a config error; keys are checked in constant time. `GET /healthz` reports the session count.
- Upstreams can be remote Streamable HTTP servers: `url` plus optional `headers` (with `${VAR}` references).
- `audit.dashboard` sends audit events in batches to the GuardBee dashboard with a workspace API key read from `apiKeyEnv`. Events wait in memory while the dashboard is unreachable; tool calls never wait for it. Events now carry `sessionId` in HTTP mode.
- `init` also moves Streamable HTTP servers behind the proxy; SSE servers stay and are reported.
- A shared upstream now fans its `tools/list_changed` notification out to every session; before, only the most recent listener received it.
- Dockerfile for running the proxy as a service.
