# @guardbee/mcp-config-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP server that audits the MCP client config on a machine: Cursor `mcp.json`, Claude Desktop `claude_desktop_config.json`, Windsurf `mcp_config.json`, and VS Code `mcp.json`.

`mcp-server-auditor` reads an MCP server's source. This package reads the config that decides which servers an agent will run. It does not start those servers and it does not send the config anywhere.

```
Claude ──► mcp-config-auditor ──► mcp.json
              │
              ├─ Unpinned package     (npx -y pkg, @latest)
              ├─ Typosquat            (one edit from a known server package)
              ├─ Secret in env/args
              ├─ autoApprove "*"
              ├─ Remote HTTP without auth
              └─ Cross-server shadowing (when you pass a tool inventory)
```

## Checks

| Pattern | Severity | OWASP | What it means |
|---|---|---|---|
| `unpinned_package` | high | MCP04:2025 | A launcher (`npx`, `uvx`, `pnpm`, `yarn`, `bunx`, `pipx`) runs a package with no `major.minor.patch` pin |
| `typosquat_package` | critical | MCP04:2025 | The package name is one edit from a known MCP server package |
| `secret_in_env` | critical | MCP01:2025 | A credential-shaped value or a sensitive key with a long literal |
| `secret_in_args` | critical | MCP01:2025 | A token on the command line |
| `auto_approve_wildcard` | critical | MCP02:2025 | `autoApprove` / `alwaysAllow` is `*` or `true` |
| `cleartext_remote` | high | MCP07:2025 | A non-loopback `http://` URL |
| `unauthenticated_remote` | high/medium | MCP07:2025 | A non-loopback URL with no `Authorization` / API-key header and no token env var |
| `cross_server_tool_shadow` | high | MCP03:2025 | The same tool name on two servers |
| `confusable_tool_name` | critical | MCP03:2025 | Homoglyph or one-edit tool names across servers |
| `cross_server_tool_redirect` | high | MCP03:2025 | A description tells the model to call another server's tool |

Loopback URLs (`localhost`, `127.0.0.1`, `::1`) are not remote findings. Placeholder values (`${API_KEY}`, `changeme`) are not secrets. Reported secret matches are redacted.

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
```

A directory scan only opens `mcp.json`, `mcp_config.json`, and `claude_desktop_config.json`. Pass a file path to scan any other name.

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
