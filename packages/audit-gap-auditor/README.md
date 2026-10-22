# @guardbee/mcp-audit-gap-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-audit-gap-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-audit-gap-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-audit-gap-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-audit-gap-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor/LICENSE)

An MCP server that audits MCP server source for **OWASP MCP08:2025 — Lack of Audit and Telemetry**.

`security-proxy` already writes a hash-chained audit log at the gateway. This package asks a different question: does the MCP *server itself* leave a usable, non-leaky trail when a tool runs?

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

```
Claude ──► audit-gap-auditor ──► MCP server source
              │
              ├─ missing-telemetry  (tools registered, no audit/log/telemetry of invocations)
              ├─ unsafe-logging     (raw tool args or results written to logs)
              ├─ disabled-audit     (audit/telemetry hard-disabled in source)
              └─ silent-failure     (tool errors swallowed with an empty catch)
```

## What it flags

| Pattern | Severity | OWASP | Meaning |
|---|---|---|---|
| `mcp_server_without_tool_audit` | high | MCP08:2025 | `McpServer` / FastMCP registers tools but the file never mentions audit/telemetry |
| `raw_tool_args_logged` | critical | MCP08:2025 | `console`/`logger` logs the full `args`/`params`/`input` object |
| `raw_tool_result_logged` | high | MCP08:2025 | Full `result` / `toolResult` logged |
| `audit_disabled_in_code` | high | MCP08:2025 | `audit: false`, `enableAudit: false`, `GUARDBEE_TELEMETRY=0`, … |
| `tool_error_swallowed_silently` | medium | MCP08:2025 | Empty / return-only `catch` around a tool handler |
| `audit_log_without_correlation_id` | medium | MCP08:2025 | `audit.log({…})` with no `sessionId` / `requestId` / similar |

Logging checks only run in files that look like MCP tool servers, so ordinary `console.log(args)` helpers elsewhere are ignored.

## Quick start

```json
{
  "mcpServers": {
    "guardbee-audit-gap-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-audit-gap-auditor"]
    }
  }
}
```

```bash
npx @guardbee/mcp-audit-gap-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

## Tools

| Tool | Purpose |
|---|---|
| `scan_text` | Scan a source string |
| `scan_file` | Scan one file |
| `scan_directory` | Recursive scan |
| `list_patterns` | List MCP08 checks |

`guardbee.yml`:

```yaml
audit-gap-auditor:
  fail-on: high
  max-files: 5000
  exclude:
    - "fixtures/"
```

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
