# @guardbee/mcp-config-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-config-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-config-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-config-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-config-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/LICENSE)

An MCP server that audits the MCP client config on a machine: Cursor `mcp.json`, Claude Desktop `claude_desktop_config.json`, Windsurf `mcp_config.json`, and VS Code `mcp.json`.

`mcp-server-auditor` reads an MCP server's source. This package reads the config that decides which servers an agent will run. It does not start those servers and it does not send the config anywhere.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

```
Claude ──► mcp-config-auditor ──► mcp.json  (or host-wide discover)
              │
              ├─ Unpinned package     (npx -y pkg, @latest)
              ├─ Typosquat            (one edit from a known server package)
              ├─ Secret in env/args
              ├─ autoApprove "*"
              ├─ Remote HTTP without auth
              ├─ Cross-server shadowing (when you pass a tool inventory)
              ├─ Agent SKILL.md (allowed-tools, body, lookalike names)
              └─ Shadow MCP discover  (OWASP MCP09 — host paths + org allowlist)
```

## Checks

| Pattern | Severity | OWASP | What it means |
|---|---|---|---|
| `unpinned_package` | high | MCP04:2025 | A launcher (`npx`, `uvx`, `pnpm`, `yarn`, `bunx`, `pipx`) runs a package with no `major.minor.patch` pin |
| `unpinned_container_image` | high | MCP04:2025 | `docker run` / `podman run` starts an image by tag, not by `@sha256:` digest |
| `typosquat_package` | critical | MCP04:2025 | The package name is one edit from a known MCP server package |
| `secret_in_env` | critical | MCP01:2025 | A credential-shaped value or a sensitive key with a long literal |
| `secret_in_args` | critical | MCP01:2025 | A token on the command line |
| `auto_approve_wildcard` | critical | MCP02:2025 | `autoApprove` / `alwaysAllow` is `*` or `true` |
| `cleartext_remote` | high | MCP07:2025 | A non-loopback `http://` URL |
| `unauthenticated_remote` | high/medium | MCP07:2025 | A non-loopback URL with no `Authorization` / API-key header and no token env var |
| `cross_server_tool_shadow` | high | MCP03:2025 | The same tool name on two servers |
| `confusable_tool_name` | critical | MCP03:2025 | Homoglyph or one-edit tool names across servers |
| `cross_server_tool_redirect` | high | MCP03:2025 | A description tells the model to call another server's tool |
| `skill_unrestricted_shell` | critical | MCP02:2025 | `allowed-tools` includes bare `Bash`, `shell`, or `*` |
| `skill_unrestricted_write` | high | MCP02:2025 | `allowed-tools` includes `Write` or `Edit` with no path limit |
| `skill_instruction_override` | critical | MCP06:2025 | The skill tells the model to ignore prior instructions |
| `skill_covert_instruction` | critical | MCP06:2025 | The skill tells the model to hide its behavior from the user |
| `skill_secret_file_read` | critical | MCP01:2025 | The skill tells the model to read `.ssh`, `.env`, or a similar file |
| `skill_at_secret_ref` | critical | MCP01:2025 | An `@` reference inlines a credential path |
| `secret_in_skill` | critical | MCP01:2025 | A literal token is written in the skill file |
| `skill_name_shadow` | high | MCP03:2025 | Two `SKILL.md` files use the same name |
| `skill_confusable_name` | critical | MCP03:2025 | Two skill names differ only by a lookalike character |
| `shadow_mcp_server` | high | MCP09:2025 | `discover` — server installed on the host but not on the org allowlist |
| `allowlist_not_configured` | medium | MCP09:2025 | `discover` ran without an allowlist |
| `unreviewed_mcp_server` | low | MCP09:2025 | Server seen during discover with no allowlist yet |
| `mcp_server_drift_across_clients` | medium | MCP09:2025 | Same server key maps to different packages/URLs in two clients |
| `mcp_index_grade_below_minimum` | high (F: critical) | MCP04:2025 | `--min-grade` — the server's GuardBee MCP Index grade is below the minimum |

Loopback URLs (`localhost`, `127.0.0.1`, `::1`) are not remote findings. Placeholder values (`${API_KEY}`, `changeme`) are not secrets. Reported secret matches are redacted. `Bash(git diff:*)` is a command allowlist and is not an unrestricted shell. `Read` alone is not flagged.

## Quick start

```json
{
  "mcpServers": {
    "guardbee-mcp-config-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-config-auditor"]
    }
  }
}
```

```bash
npx @guardbee/mcp-config-auditor scan .cursor/mcp.json --fail-on=high --format=sarif > results.sarif
npx @guardbee/mcp-config-auditor inventory ./tool-inventory.json
npx @guardbee/mcp-config-auditor discover --allowlist=./mcp-allowlist.json --fail-on=high
```

### GuardBee MCP Index grades

`--grades` (on `scan <file>` and `discover`) shows the [GuardBee MCP Index](https://guardbee.github.io/guardbee-mcp/) grade of every configured server: an A–F trust grade for each server in the official MCP Registry, rebuilt weekly from its published package. The grade comes from the shipped code (the GuardBee scanners), known vulnerabilities and malware (OSV), Sigstore build provenance and maintenance signals; the [rubric](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-index/RUBRIC.md) is public and versioned. `--min-grade=C` also reports every server graded below C (`mcp_index_grade_below_minimum`, so `--fail-on` can gate on it).

```bash
npx @guardbee/mcp-config-auditor discover --min-grade=C
#   A  filesystem  npm:@modelcontextprotocol/server-filesystem  graded @modelcontextprotocol/server-filesystem@2026.10.1
#   D  notes       npm:notes-mcp                                graded notes-mcp@1.4.0 (the config runs the latest version)
#   –  internal    local command: not a registry package
```

The whole index is downloaded (and cached for a day in `~/.guardbee/mcp-index.json`) and searched on this machine, so no server or package name is sent anywhere. `--offline` uses the cache only; `--index-url=` points at another copy. Local commands, remote URLs and servers outside the official registry have no grade and are never findings.

### Shadow MCP discover (MCP09)

Walks well-known Cursor / Claude Desktop / Claude Code / Windsurf / VS Code / Gemini CLI / Cline / Zed paths on this machine and compares every installed server to an organization allowlist. Does not start servers. Claude Code's per-project servers (`projects["<path>"].mcpServers` in `~/.claude.json`) are listed under `claude-code:<path>`; Zed's `context_servers` and JSON with comments are understood.

**Inventory.** `--format=json` adds an `inventory`: for every server its client, config path, name, transport, command and arguments, npm/PyPI package with version and whether it is pinned, URL, the **names** of its env variables and headers, auto-approve, and the findings for it. It never holds a secret: env and header values are left out, argument values after `--token`/`--api-key`-style flags, `KEY=value` pairs, provider tokens and passwords in connection strings are `[redacted]`, and URLs lose their credentials and query values. `--format=text` prints the same list; `--format=sarif` the findings.

**Fleet.** [FLEET.md](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/mcp-config-auditor/FLEET.md) has Jamf, Intune, systemd and CI recipes. `--allowlist-from-dashboard` checks against the organization allowlist admins manage in the dashboard (merged with `--allowlist` when both are given), and `--grades` adds MCP Index grades to the uploaded inventory.

**Organisation-wide.** `--upload` sends the inventory to the GuardBee dashboard (`GUARDBEE_API_KEY`, a workspace key with the `gateway.write` scope), which keeps the latest inventory per machine; run it from your device-management tool or a login script. The machine's host name, OS and OS user name are included — `--no-user` leaves the user out.

```bash
GUARDBEE_API_KEY=gb_… npx @guardbee/mcp-config-auditor discover --allowlist=./mcp-allowlist.json --upload --fail-on=none
```

Allowlist JSON:

```json
{
  "names": ["filesystem", "github"],
  "packages": ["@modelcontextprotocol/server-filesystem", "@guardbee/mcp-secret-scanner"],
  "hosts": ["mcp.example.com"]
}
```

Or lines: `name:filesystem`, `package:@scope/pkg`, `host:mcp.example.com`, or a bare server name.

A directory scan opens `mcp.json`, `mcp_config.json`, `claude_desktop_config.json`, and `SKILL.md`. Pass a file path to scan any other name. A file named `SKILL.md` is audited as an agent skill. Same-name and lookalike skill findings appear on a directory scan, because one file cannot see the others.

`guardbee.yml`:

```yaml
mcp-config-auditor:
  fail-on: high
  max-files: 5000
  exclude:
    - "fixtures/"
```

Tool inventory shape:

```json
{
  "servers": [
    { "name": "github", "tools": [{ "name": "create_issue", "description": "Open an issue" }] }
  ]
}
```

Shadowing needs that inventory because a client config does not list tools. `rug-pull-detector` can collect a live `tools/list`; this package compares several of those lists.

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
