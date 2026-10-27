# @guardbee/mcp-telemetry

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-telemetry.svg)](https://www.npmjs.com/package/@guardbee/mcp-telemetry)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-telemetry.svg)](https://www.npmjs.com/package/@guardbee/mcp-telemetry)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/LICENSE)

The shared, opt-in usage telemetry client used by other GuardBee MCP packages. Not an MCP server on its own, just a library — you don't need to install this package directly.

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

## Enabling

Telemetry is **off** unless you turn it on:

```bash
GUARDBEE_TELEMETRY=1   # or true / on / yes
```

Set this env var when running any GuardBee MCP package. Nothing is sent without it, and no notice is printed. When it is on, the first call prints a one-time notice to stderr saying what is sent and where (`https://app.guardbee.ai/api/telemetry/mcp`, or `GUARDBEE_TELEMETRY_ENDPOINT`).

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

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
