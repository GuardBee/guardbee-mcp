# @guardbee/mcp-owasp-scan

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md) | [🇯🇵 日本語](JA.md) | [🇰🇷 한국어](KO.md) | [🇧🇷 Português](PT-BR.md) | [🇪🇸 Español](ES.md) | [🇩🇪 Deutsch](DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-owasp-scan.svg)](https://www.npmjs.com/package/@guardbee/mcp-owasp-scan)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-owasp-scan.svg)](https://www.npmjs.com/package/@guardbee/mcp-owasp-scan)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

One CLI and MCP server for a **unified [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) check**. It runs seven GuardBee auditors over a codebase in one pass, or grades a live MCP server's tool list, and reports every finding under its OWASP id with an A–F grade. Output as text, JSON or SARIF for GitHub code scanning.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](../telemetry/README.md).

## Quick start

```bash
# Static scan of a repository, fail CI on high or critical findings
npx @guardbee/mcp-owasp-scan scan ./src --format=sarif --fail-on=high > owasp.sarif

# Connect to a running MCP server and grade its tools
npx @guardbee/mcp-owasp-scan live --url=https://mcp.example.com/mcp
npx @guardbee/mcp-owasp-scan live --stdio=npx --arg=-y --arg=@modelcontextprotocol/server-filesystem --arg=.

# Grade a saved tools/list response
npx @guardbee/mcp-owasp-scan catalog ./tools.json --format=json
```

As an MCP server (Claude Desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "guardbee-owasp-scan": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-owasp-scan"]
    }
  }
}
```

## Modes

| Mode | Input | What runs |
|---|---|---|
| `scan <path>` | A file or directory | secret-scanner, mcp-server-auditor, oauth-auditor, audit-gap-auditor, context-oversharing-auditor, toxic-flow-auditor, tool-poisoning-scanner |
| `live` | `--url=<streamable HTTP URL>` or `--stdio=<command>` with `--arg=…` | Connects, calls `tools/list`, then toxic-flow-auditor and tool-poisoning-scanner |
| `catalog <tools.json>` | A `tools/list` dump (`{ "tools": [...] }` or a bare array) | Same checks as `live`, offline |

`--discover-shadow` adds an **MCP09** check to `scan`: it inventories the MCP servers configured on this machine (Cursor, Claude Desktop, Windsurf, VS Code) through `mcp-config-auditor`, and `--allowlist=<path>` marks the approved ones.

## OWASP MCP Top 10 coverage

| ID | Risk | Covered by |
|---|---|---|
| MCP01 | Token / credential exposure | secret-scanner, mcp-server-auditor |
| MCP02 | Privilege / excessive agency | mcp-server-auditor |
| MCP03 | Tool poisoning / rug pull surface | tool-poisoning-scanner (`scan`, `live`, `catalog`) |
| MCP04 | Supply chain | Not in this meta-scan: use [`mcp-dependency-auditor`](../dependency-auditor) and [`mcp-slopsquat-scanner`](../slopsquat-scanner), which need the network |
| MCP05 | Command / code injection via tools | mcp-server-auditor |
| MCP06 | Prompt / context injection | Not in this meta-scan: use [`mcp-prompt-injection-scanner`](../prompt-injection-scanner) on the content an agent reads |
| MCP07 | Auth / OAuth misconfiguration | oauth-auditor |
| MCP08 | Lack of audit and telemetry | audit-gap-auditor |
| MCP09 | Shadow MCP servers | mcp-config-auditor (`--discover-shadow`) |
| MCP10 | Toxic flows / context oversharing | toxic-flow-auditor, context-oversharing-auditor (`scan`, `live`, `catalog`) |

## Grade

| Grade | When |
|---|---|
| **F** | A lethal trifecta: one agent can read untrusted content, reach sensitive data and send data out |
| **D** | Any critical finding |
| **C** | Any high finding |
| **B** | Only medium or low findings |
| **A** | No findings |

## CLI options

| Option | Default | Meaning |
|---|---|---|
| `--format=text\|json\|sarif` | `text` | Report format. SARIF uploads to GitHub code scanning |
| `--fail-on=any\|critical\|high\|medium\|none` | `any` | Exit 1 when a finding at or above this severity exists |
| `--max-files=<n>` | `5000` | Stop a path scan after this many files |
| `--discover-shadow` | off | Add the MCP09 host inventory to `scan` |
| `--allowlist=<path>` | – | Approved servers for `--discover-shadow` |

Exit codes: `0` clean (or below `--fail-on`), `1` findings at or above `--fail-on`, `2` usage error.

## MCP tools

| Tool | What it does |
|---|---|
| `owasp_scan_path` | The `scan` mode over a path (`path`, `maxFiles`, `discoverShadow`, `allowlistPath`) |
| `owasp_scan_live` | The `live` mode (`url`, or `command` with `args`) |
| `owasp_scan_catalog` | The `catalog` mode on a JSON string |
| `list_owasp_coverage` | The coverage table above |

## GitHub Actions

```yaml
- run: npx -y @guardbee/mcp-owasp-scan scan . --format=sarif --fail-on=high > owasp.sarif
- uses: github/codeql-action/upload-sarif@v3
  if: always()
  with:
    sarif_file: owasp.sarif
```

## Related packages

Each auditor is also its own package with more options: [`mcp-secret-scanner`](../secret-scanner), [`mcp-server-auditor`](../mcp-server-auditor), [`mcp-oauth-auditor`](../oauth-auditor), [`mcp-audit-gap-auditor`](../audit-gap-auditor), [`mcp-context-oversharing-auditor`](../context-oversharing-auditor), [`mcp-toxic-flow-auditor`](../toxic-flow-auditor), [`mcp-tool-poisoning-scanner`](../tool-poisoning-scanner), [`mcp-config-auditor`](../mcp-config-auditor). To enforce these rules at runtime instead of finding them in code, put [`mcp-security-proxy`](../security-proxy) in front of your MCP servers.

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
