# @guardbee/mcp-owasp-scan

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-owasp-scan.svg)](https://www.npmjs.com/package/@guardbee/mcp-owasp-scan)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-owasp-scan.svg)](https://www.npmjs.com/package/@guardbee/mcp-owasp-scan)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/owasp-scan/LICENSE)

One CLI and MCP server for a **unified [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) check**. It runs seven GuardBee auditors over a codebase in one pass, or grades a live MCP server's tool list, and reports every finding under its OWASP id with an A–F grade. Output as text, JSON or SARIF for GitHub code scanning.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

## Quick start

```bash
# Static scan of a repository, fail CI on high or critical findings
npx @guardbee/mcp-owasp-scan scan ./src --format=sarif --fail-on=high > owasp.sarif

# Connect to a running MCP server and grade its tools
npx @guardbee/mcp-owasp-scan live --url=https://mcp.example.com/mcp
npx @guardbee/mcp-owasp-scan live --stdio=npx --arg=-y --arg=@modelcontextprotocol/server-filesystem --arg=.

# Grade a saved tools/list response
npx @guardbee/mcp-owasp-scan catalog ./tools.json --format=json

# Audit every MCP server configured on this machine, in every client
npx @guardbee/mcp-owasp-scan installed --run-stdio
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
| `live` | `--url=<Streamable HTTP or legacy SSE URL>` or `--stdio=<command>` with `--arg=…` | Connects, calls `tools/list`, then toxic-flow-auditor and tool-poisoning-scanner |
| `catalog <tools.json>` | A `tools/list` dump (`{ "tools": [...] }` or a bare array) | Same checks as `live`, offline |
| `installed` | Nothing: reads the MCP client configs on this machine | Connects to every configured server, then the `live` checks per server plus cross-server checks (below) |

### `installed`: every server on this machine

`installed` finds the MCP servers configured in Claude Desktop, Claude Code (user and per-project), Cursor, VS Code, Windsurf, Cline, Roo Code, Zed, Gemini CLI, Codex (`~/.codex/config.toml`), Kiro, Copilot CLI, Amazon Q, LM Studio and opencode, contacts each one once (a server listed in several clients is one server) and reports:

- **Per server:** tool poisoning and toxic flows in its `tools/list`, as `live` does.
- **Across servers:** the agent sees every connected server's tools at once, so a lethal trifecta split over three harmless-looking servers (`cross_server_lethal_trifecta`) and the same or a look-alike tool name on two servers (`cross_server_tool_shadow`, `confusable_tool_name`) are reported. A single-server scan cannot see either.
- **Changes since the last run (rug pull):** tool definitions are pinned in `~/.guardbee/tool-pins` on the first run; a changed description or schema is reported as `tool_definition_drift` (critical) on every run until you re-approve it by deleting that server's pin file. Pins hold the tool definitions and the server's command line or URL, never env or header values.
- **Shadow MCP (MCP09):** with `--allowlist=<path>`, servers that are not approved.

Remote servers are always contacted, with the headers from their config, over Streamable HTTP and then legacy SSE if that fails. **Local (stdio) servers are only started with `--run-stdio`**, because starting one runs its code on your machine with the env from your config; without it they are listed as skipped. Disabled entries are never started. A server that cannot be reached is listed with the error and the scan goes on.

```bash
npx @guardbee/mcp-owasp-scan installed --run-stdio --allowlist=./mcp-allowlist.json --format=sarif --fail-on=high
```

`scan` reads TypeScript/JavaScript, Python (FastMCP, official SDK, low-level server), Go (official go-sdk, mark3labs/mcp-go) and Rust (rmcp `#[tool]` / `#[tool_router]`) MCP servers in full: tool definitions, handler sinks and OAuth rules. Other languages (Java, Kotlin, C#, Ruby, PHP, Swift) get the language-neutral rules only (secrets, URLs, config). The report's `coverage` lists every source file with its language, that depth (`full` or `patterns`) and the number of tool definitions found, plus a per-language summary (`languages:` in text output), so a file the scan could not read deeply is visible rather than silently passing.

`--discover-shadow` adds an **MCP09** check to `scan`: it inventories the MCP servers configured on this machine (Cursor, Claude Desktop, Windsurf, VS Code) through `mcp-config-auditor`, and `--allowlist=<path>` marks the approved ones.

## OWASP MCP Top 10 coverage

| ID | Risk | Covered by |
|---|---|---|
| MCP01 | Token / credential exposure | secret-scanner, mcp-server-auditor |
| MCP02 | Privilege / excessive agency | mcp-server-auditor |
| MCP03 | Tool poisoning / rug pull surface | tool-poisoning-scanner (`scan`, `live`, `catalog`) |
| MCP04 | Supply chain | Opt-in: `--with-supply-chain` / `withSupplyChain` runs [`mcp-dependency-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/dependency-auditor) (OSV) and [`mcp-slopsquat-scanner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/slopsquat-scanner) (needs the network). Listed in `notRun` when off |
| MCP05 | Command / code injection via tools | mcp-server-auditor |
| MCP06 | Prompt / context injection | Opt-in: `--with-content` / `withContent` runs [`mcp-prompt-injection-scanner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/prompt-injection-scanner) on content under the path. Listed in `notRun` when off |
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
| `--with-supply-chain` | off | Add MCP04 (OSV dependency audit + slopsquat; needs network) |
| `--with-content` | off | Add MCP06 (prompt injection on docs/content under the path) |
| `--allowlist=<path>` | – | Approved servers for `--discover-shadow` and `installed` |
| `--run-stdio` | off | `installed`: also start local (stdio) servers to read their tools |
| `--timeout=<ms>` | `15000` | `installed` and `live`: per-server connect and `tools/list` timeout |
| `--pin-dir=<dir>` | `~/.guardbee/tool-pins` | `installed`: where tool pins are kept |
| `--no-pin` | off | `installed`: do not read or write tool pins |

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

Each auditor is also its own package with more options: [`mcp-secret-scanner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/secret-scanner), [`mcp-server-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-server-auditor), [`mcp-oauth-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor), [`mcp-audit-gap-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/audit-gap-auditor), [`mcp-context-oversharing-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/context-oversharing-auditor), [`mcp-toxic-flow-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/toxic-flow-auditor), [`mcp-tool-poisoning-scanner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/tool-poisoning-scanner), [`mcp-config-auditor`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor). To enforce these rules at runtime instead of finding them in code, put [`mcp-security-proxy`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy) in front of your MCP servers.

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
