# @guardbee/mcp-ai-code-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans your codebase for security patterns commonly found in LLM/AI integrations.

While `secret-scanner` looks for leaked secrets/API keys, this package looks for **patterns**: how much a model's output is trusted, how privileged the tools it can call are, what data is sent to a third-party LLM — risks that a static credential scan can't catch.

> This package sends usage telemetry by default (tool name + short parameters, the scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► ai-code-scanner ──► Your codebase
              │
              ├─ Client-exposure    (dangerouslyAllowBrowser: true)
              ├─ Output handling    (eval(llmOutput), unvalidated JSON.parse)
              ├─ Excessive agency   (an agent tool named execute_command)
              ├─ Data privacy       (email/national ID interpolated directly into a prompt)
              └─ Prompt injection   (raw request data mixed into a system prompt)
```

---

## Features

- **10 patterns, 5 categories** — client-exposure, output-handling, excessive-agency, data-privacy, prompt-injection
- Every finding includes **why it's risky and what to do about it** (`recommendation`) — not just "found it"
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 28 unit tests — a positive and a negative (false-positive) scenario for every pattern

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-ai-code-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-ai-code-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-ai-code-scanner scan ./src --fail-on=high --format=sarif > results.sarif
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
| client-exposure | `openai_dangerously_allow_browser` | critical | OpenAI key leaked to the browser |
| client-exposure | `client_bundled_ai_api_key` | critical | An AI key enters the client bundle via `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` |
| output-handling | `eval_llm_output` | critical | Model output executed as code via `eval()`/`Function()` |
| output-handling | `exec_llm_output` | critical | Model output passed to a shell command (command injection) |
| output-handling | `llm_output_dangerously_set_inner_html` | high | Model output rendered as raw HTML (XSS) |
| output-handling | `llm_json_no_validation` | medium | Model output `JSON.parse`'d without schema validation |
| excessive-agency | `excessive_agency_tool_name` | high | A tool that grants an agent shell/code execution |
| excessive-agency | `unbounded_agent_loop` | medium | An agent loop with no iteration bound (cost/DoS) |
| data-privacy | `pii_field_in_llm_prompt` | high | Data like email/national ID/card number goes directly into a prompt |
| prompt-injection | `unsanitized_input_in_system_prompt` | medium | Raw request/user data mixed into a system prompt |

These are **heuristic** findings — a static text-pattern scan, not a full AST analysis. Designed for a low false-positive rate, but every finding should still be reviewed manually.

---

## Configuration (`guardbee.yml`)

```yaml
ai-code-scanner:
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
npm test             # 28 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
