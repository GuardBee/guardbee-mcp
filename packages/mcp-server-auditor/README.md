# @guardbee/mcp-server-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans **other MCP servers'** tool definitions for insecure patterns.

While `ai-code-scanner` looks at general LLM/AI integration code, this package specifically looks at an MCP server itself: how privileged a tool defined via `server.tool(...)` is, how loose its parameters are, which dangerous sinks (shell/filesystem/HTTP/SQL) its handler passes tool input into directly. The MCP ecosystem is growing fast, but there's no common tool yet for auditing these servers' security.

> This package sends usage telemetry by default (tool name + short parameters, the scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► mcp-server-auditor ──► An MCP server's source code
              │
              ├─ Excessive agency    (execSync(input.command), a tool named "run_shell")
              ├─ Unsafe input        (fetch(input.url) → SSRF, SQL string interpolation)
              ├─ Loose schema        (a parameter typed z.any()/z.unknown())
              ├─ Secrets exposure    (a hardcoded API key in a schema default, the entire process.env)
              └─ Network exposure    (wildcard CORS)
```

---

## Features

- **10 patterns, 5 categories** — excessive-agency, unsafe-input, loose-schema, secrets-exposure, network-exposure
- Every finding includes **why it's risky and what to do about it** (`recommendation`) — not just "found it"
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 32 unit tests — a positive and a negative (false-positive) scenario for every pattern

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-mcp-server-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-server-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-server-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans a given text/code snippet |
| `scan_file` | Scans a single file |
| `scan_directory` | Recursively scans a directory (`node_modules`, `.git`, `dist` skipped automatically) |
| `list_patterns` | Lists all supported patterns by category |

---

## Detected Patterns

| Category | Pattern | Severity | What it means |
|---|---|---|---|
| excessive-agency | `shell_exec_from_tool_input` | critical | A tool handler passes tool input directly into a shell call like `execSync`/`spawn` |
| excessive-agency | `eval_of_tool_input` | critical | Tool input is executed as code via `eval()`/`new Function()` |
| excessive-agency | `unrestricted_shell_tool_name` | high | A tool name (`run_shell`, `execute_sql`, etc.) implies shell/SQL execution directly |
| unsafe-input | `fs_write_from_raw_tool_input` | high | A path from tool input flows into a file write/delete call with no validation (path traversal) |
| unsafe-input | `ssrf_fetch_from_tool_input` | high | A URL from tool input flows directly into `fetch`/`axios` with no allowlist (SSRF) |
| unsafe-input | `sql_injection_via_tool_input` | critical | Tool input is interpolated into a SQL string via a template literal |
| loose-schema | `overly_permissive_tool_schema` | medium | A tool parameter is typed `z.any()`/`z.unknown()` — accepts anything |
| secrets-exposure | `hardcoded_secret_in_tool_schema` | critical | A credential-shaped schema field's default value is a hardcoded literal |
| secrets-exposure | `full_env_exposed_to_tool_caller` | critical | The entire `process.env` is spread/stringified/returned (not one named variable) |
| network-exposure | `permissive_cors_on_server` | medium | Wildcard CORS (`Access-Control-Allow-Origin: *`) or `cors()` with no options |

These are **heuristic** findings — a static text-pattern scan, not a full AST/type analysis. Designed for a low false-positive rate, but every finding should still be reviewed manually.

---

## Configuration (`guardbee.yml`)

```yaml
mcp-server-auditor:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - "**/*.test.ts"
    - "fixtures/"
```

---

## Development

```bash
npm run build
npm test             # 32 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
