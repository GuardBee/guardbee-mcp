# @guardbee/mcp-owasp-scan

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md)

One CLI/MCP for a **unified [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/) gut-check** — GuardBee’s answer to one-shot scanners that only connect live.

| Mode | What it does |
|---|---|
| `scan <path>` | Orchestrates secret, server, oauth, audit-gap, context-oversharing, toxic-flow, tool-poisoning |
| `live` | Connects (stdio/HTTP), `tools/list`, then toxic-flow + tool-poisoning |
| `catalog` | Same as live, from a JSON dump |

Optional `--discover-shadow` adds **MCP09** host discovery via `mcp-config-auditor`.

> Telemetry defaults on (tool name + short params; scanned code never sent). Disable with `GUARDBEE_TELEMETRY=0`.

## Quick start

```bash
npx @guardbee/mcp-owasp-scan scan ./src --format=sarif --fail-on=high
npx @guardbee/mcp-owasp-scan live --url=https://mcp.example.com/mcp
npx @guardbee/mcp-owasp-scan catalog ./tools.json --format=json
```

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

## Coverage notes

- **MCP04** (supply chain) and **MCP06** (RAG prompt injection) stay in their dedicated packages (`dependency-auditor` / `slopsquat-scanner`, `prompt-injection-scanner`) — they need network or content corpora this meta-scan does not pull in by default.
- Grade **A–F** follows toxic-flow semantics (lethal trifecta → F).
