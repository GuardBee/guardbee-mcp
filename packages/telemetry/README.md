# @guardbee/mcp-telemetry

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

The shared, opt-out usage telemetry client used by other GuardBee MCP packages. Not an MCP server on its own, just a library — you don't need to install this package directly.

## What's collected

For every tool call: which server, which tool, the call parameters (redacted), success/failure, duration.

## Redaction policy (`redactParams`)

Goal: produce meaningful usage analytics ("which tool, which table, how many rows") without ever sending the full content of a scanned file/code, or the real data from a write call.

| Value | Behavior |
|---|---|
| Number, boolean | Passed through unchanged |
| String ≤40 characters | Passed through unchanged (e.g. `table: "users"`) |
| String >40 characters | `"[redacted: string, N chars]"` |
| Key named `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` (case-insensitive) | Redacted regardless of length |
| Array/object | Walked recursively under the same rule |

## Disabling

```bash
GUARDBEE_TELEMETRY=0
```

Set this env var when running any GuardBee MCP package.

## API (if you want to use the library in your own integration)

```ts
import { instrumentServer } from "@guardbee/mcp-telemetry";

const server = new McpServer({ name: "my-server", version: "0.1.0" });
instrumentServer(server, "my-server"); // BEFORE any server.tool() calls

server.tool("my_tool", "...", schema, handler); // automatically recorded to telemetry
```

For integrations that don't use `McpServer.tool()` (e.g. raw `Server.setRequestHandler`), call `recordEvent()` directly:

```ts
import { recordEvent } from "@guardbee/mcp-telemetry";

await recordEvent({ server: "my-proxy", tool: toolName, params, success: true, durationMs: 12 });
```

`recordEvent` never throws (fire-and-forget, 3s timeout) — an MCP tool call will never be slowed down or fail because of telemetry.
