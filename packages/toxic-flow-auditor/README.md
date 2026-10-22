# @guardbee/mcp-toxic-flow-auditor

[![Redthread scan](https://trust.redthreadsec.com/badge/mcp/io.github.GuardBee/toxic-flow-auditor.svg)](https://trust.redthreadsec.com/v/mcp/io.github.GuardBee/toxic-flow-auditor)

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-toxic-flow-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-toxic-flow-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-toxic-flow-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-toxic-flow-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor/LICENSE)

An MCP server that audits an MCP **tool catalog** for **toxic flows** — Simon Willison's *lethal trifecta*:

1. **Untrusted content** (fetch, scrape, browse, issues, feeds)
2. **Sensitive / private data** (vault, DB, secrets, KVKK-regulated PII)
3. **Exfiltration or destruction** (send, webhook, export, delete, drop)

When one MCP server exposes all three, a single prompt injection can chain them. Mapped primarily to **OWASP MCP10:2025**.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

```
Claude ──► toxic-flow-auditor ──► tools/list JSON or MCP server source
              │
              ├─ lethal_trifecta      (untrusted + sensitive + outbound)
              ├─ single_tool_trifecta (one tool alone spans all three)
              ├─ sensitive_plus_exfil
              ├─ untrusted_plus_exfil
              └─ sensitive_plus_destruct
```

## What it flags

- **Lethal trifecta across the catalog.** Tools that fetch untrusted content, reach vault/DB/PII, and can send data out or destroy it — on the same server.
- **Single-tool trifecta.** One registration whose name/description itself spans all three capabilities.
- **Dangerous pairs.** Sensitive+exfil, untrusted+exfil, or sensitive+destructive even when the full trifecta is not present.
- **KVKK-aware heuristics.** Turkish PII signals (`tc_kimlik`, `müşteri`, `KVKK`) count as sensitive data.
- **snake_case names read word by word.** `read_vault_secret` and `drop_table` are classified by each word; opening a pull request counts as exfiltration.

Grades **A–F**. No API key. Static / catalog analysis only — does not call live tools.

The classification rules come from [`@guardbee/guard-core`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/README.md); `@guardbee/mcp-security-proxy` uses the same rules to block toxic flows at runtime.

## Tools

| Tool | Purpose |
|---|---|
| `audit_catalog` | Audit a `tools/list`-shaped JSON dump |
| `scan_source` | Extract `.tool(...)` registrations from source text |
| `scan_file` | Scan one source file |
| `scan_directory` | Recursive scan; merges tools across files |
| `explain_trifecta` | Explain the model |

## CLI

```
npx @guardbee/mcp-toxic-flow-auditor audit <tools.json> [--fail-on=any] [--format=text|json|sarif]
npx @guardbee/mcp-toxic-flow-auditor scan <path>        [--fail-on=any] [--format=text|json|sarif]
```

Example catalog:

```json
{
  "tools": [
    { "name": "fetch_page", "description": "Scrape a URL" },
    { "name": "read_vault_secret", "description": "Read API key from vault" },
    { "name": "send_slack_message", "description": "Post to webhook" }
  ]
}
```

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
