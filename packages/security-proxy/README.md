# @guardbee/mcp-security-proxy

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A transparent security layer that sits in front of any MCP server. Blocks prompt injection attacks, masks PII in responses, and writes every request to an immutable audit log.

> This package sends usage telemetry to GuardBee by default (tool name + short parameters, see [`@guardbee/mcp-telemetry`](../telemetry/README.md)) — separate from and independent of its own local audit log. Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► MCP Security Proxy ──► Any MCP Server
                │
                ├─ Prompt injection detection  (16 attack patterns)
                ├─ PII masking                 (national ID, IBAN, email, JWT, API key)
                ├─ Block or warn mode
                ├─ Toxic-flow (lethal trifecta) blocking
                └─ Hash-chained audit log
```

---

## Features

- **Prompt Injection Protection** — 16 attack patterns block requests attempting to override system prompts
- **Tool-result injection** — the same patterns applied to tool results, tagged MCP06:2025. Block mode replaces the result; warn mode prepends a warning
- **Session tool pin** — the first `tools/list` is pinned. A later description or schema change is a rug pull (MCP03:2025). Block mode keeps serving the pinned definition and refuses the drifted call
- **PII Masking** — national ID numbers, IBAN, email, phone, JWT tokens, API keys are automatically masked in responses
- **Block / Warn Mode** — each interceptor can independently run in blocking or warning mode
- **Audit Log** — configurable log written to console or a file
- **Gateway mode** — several MCP servers behind one proxy, one YAML policy (allow / deny / mask / warn)
- **Toxic-flow blocking** — tracks the lethal trifecta across servers and blocks the egress call that would complete it
- **Zero Code Changes** — attaches in front of any existing MCP server

---

## Quick Start

```bash
npm install -g @guardbee/mcp-security-proxy
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "secure-filesystem": {
      "command": "npx",
      "args": [
        "-y", "@guardbee/mcp-security-proxy",
        "--", "npx", "-y",
        "@modelcontextprotocol/server-filesystem", "/tmp"
      ]
    }
  }
}
```

> The proxy launches whatever comes after `--` as the target MCP server.

---

## Gateway Mode: Several Servers, One Policy

Put every MCP server behind one proxy with a `guardbee-proxy.yaml`:

```json
{
  "mcpServers": {
    "guardbee": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-security-proxy", "--config", "/path/to/guardbee-proxy.yaml"]
    }
  }
}
```

```yaml
version: 1
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }   # read from the environment
  postgres:
    command: npx
    args: ["-y", "@guardbee/mcp-db-gateway"]

labels:                       # override the heuristic labels
  github__get_issue: [untrusted]
  github__create_pull_request: [egress]

rules:                        # first match wins
  - id: no-deletes
    match: { tool: "postgres__delete_*" }
    action: deny              # allow | deny | mask | warn

taint:
  mode: strict                # strict | warn | off

audit:
  sink: file
  filePath: ./guardbee-audit.jsonl
```

- Tools and prompts appear as `<upstream>__<tool>`.
- **Toxic flow (lethal trifecta):** each tool is labeled `untrusted`, `sensitive`, `egress` or `destructive` (name/description heuristics, overridable under `labels`). Once a session has read untrusted content (an `untrusted` tool or any resource) and sensitive data (a `sensitive` tool or any PII in a result), an `egress` call is blocked in `strict` mode and only logged in `warn` mode. The check spans servers: an issue read from GitHub plus a customer record from a CRM blocks a webhook on a third server.
- **Rules** match on `tool` (glob), `upstream`, `label` and `session` (`clean` | `tainted`). `mask` forces PII masking for that tool even when masking is off. A rule's `allow` does not skip the toxic-flow check; relabel the tool instead.
- **Audit log** is hash-chained. By default it stores a SHA-256 of the arguments instead of the arguments, and no results; set `audit.includePayloads: true` to log them. Check a log with `guardbee-proxy verify-audit ./guardbee-audit.jsonl`.
- `guardbee-proxy validate --config guardbee-proxy.yaml` checks a config without starting any server.
- Without `--config`, the proxy also picks up `./guardbee-proxy.yaml` or `GUARDBEE_PROXY_CONFIG=<file>.yaml`.

The single-server `--` form above keeps its 0.x behavior: tool names are not prefixed, payloads are logged, and a toxic flow is only logged as a warning.

---

## MCP Tools

The proxy does not register tools of its own. It forwards the target server's tools and applies the interceptor chain on every call.

---

## Interceptors

### Prompt Injection Detector

Looks for the following attack patterns in incoming messages:

- `ignore previous instructions`
- `disregard your system prompt`
- `you are now [DAN/jailbreak]`
- `act as` / `pretend to be` role overrides
- `DAN mode`, `developer mode`, `jailbreak`
- fake `[SYSTEM]` / `<system>` tags
- and 6 more patterns

### PII Masker

| Data Type | Check | Example Input | Output |
|-----------|-------|---------------|--------|
| National ID (TC Kimlik No) | official checksum | `10000000146` | `[TC-KİMLİK]` |
| IBAN (TR) | mod-97 | `TR330006100519786457841326` | `TR**[IBAN]` |
| Card number | Luhn | `4111 1111 1111 1111` | `****-****-****-[KART]` |
| Email | — | `ahmet@example.com` | `***@[EMAIL]` |
| Phone (TR) | — | `0532 123 45 67` | `+90-***-***-**[TELEFON]` |
| JWT | — | `eyJhbGc...` | `[JWT-TOKEN]` |
| API Key | — | `sk_abc123...` | `[API-KEY]` |

A number that fails its checksum (an order number, a tracking code) is left as is.

---

## Configuration

Configurable via environment variables:

| Variable | Default | Description |
|----------|-----------|----------|
| `PROXY_MODE` | `block` | `block` or `warn` |
| `PROXY_LOG` | `console` | `console` or `file` |
| `PROXY_LOG_PATH` | `./proxy-audit.jsonl` | Log file path |
| `PROXY_PII_MASK` | `true` | Enable PII masking |
| `PROXY_INJECTION_CHECK` | `true` | Enable injection checking |

---

## License

MIT — [GuardBee](https://guardbee.ai)
