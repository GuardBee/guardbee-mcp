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
                └─ Configurable audit log
```

---

## Features

- **Prompt Injection Protection** — 16 attack patterns block requests attempting to override system prompts
- **PII Masking** — national ID numbers, IBAN, email, phone, JWT tokens, API keys are automatically masked in responses
- **Block / Warn Mode** — each interceptor can independently run in blocking or warning mode
- **Audit Log** — configurable log written to console or a file
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

## MCP Tools

The proxy transparently forwards tools from the target server, applying the interceptor chain on every pass-through. It also exposes one management tool:

| Tool | Description |
|------|----------|
| `proxy_status` | Shows active interceptors and stats on the most recently blocked requests |

---

## Interceptors

### Prompt Injection Detector

Looks for the following attack patterns in incoming messages:

- `ignore previous instructions`
- `disregard your system prompt`
- `you are now [DAN/jailbreak]`
- commands hidden via ANSI escape sequences
- base64-encoded instructions
- and 11 more patterns

### PII Masker

| Data Type | Example Input | Output |
|-----------|------------|-------|
| National ID | `12345678901` | `[TC-REDACTED]` |
| IBAN | `TR320006200...` | `TR32***` |
| Email | `ahmet@example.com` | `ah***@example.com` |
| JWT | `eyJhbGc...` | `[JWT-REDACTED]` |
| API Key | `sk-abc123...` | `[KEY-REDACTED]` |

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
