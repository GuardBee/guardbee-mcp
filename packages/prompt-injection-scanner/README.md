# @guardbee/mcp-prompt-injection-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans **content** — a RAG chunk, a scraped web page, a document — for indirect prompt injection payloads.

`ai-code-scanner` and `mcp-server-auditor` scan code; this package scans **data**. In classic prompt injection, the attacker writes a malicious prompt themselves; in indirect prompt injection, the attacker never talks to the model at all — instead they embed instructions in a document, web page, or tool result the model will later read. The moment the model pulls this content into its context via a RAG retrieval or a web fetch, the embedded instruction appears to carry the same authority as the user's own instructions.

> This package sends usage telemetry by default (tool name + short parameters, the scanned content is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Web page/RAG document ──► prompt-injection-scanner ──► LLM context
              │
              ├─ Instruction override   ("ignore all previous instructions")
              ├─ Role spoofing          ("System:", <|im_start|>, [INST])
              ├─ Hidden text            (zero-width characters, display:none + instruction, HTML comment)
              ├─ Direct address         ("Dear AI, ...")
              └─ Exfiltration           (system prompt extraction request, data → URL instruction, templated img beacon)
```

---

## Features

- **10 patterns, 5 categories** — instruction-override, role-spoofing, hidden-text, direct-address, exfiltration
- Every finding includes **why it's risky and what to do about it** (`recommendation`) — not just "found it"
- SARIF 2.1.0 output — CI/CD integration (e.g. auto-scanning a knowledge-base repo on every PR)
- Config file support via `guardbee.yml`
- 30 unit tests — a positive and a negative (false-positive) scenario for every pattern; known false-positive sources like emoji ZWJ sequences and ordinary `display:none` modals are specifically tested

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-prompt-injection-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-prompt-injection-scanner"]
    }
  }
}
```

### CLI (CI/CD — e.g. scan a RAG knowledge-base repo on every PR)

```bash
npx @guardbee/mcp-prompt-injection-scanner scan ./knowledge-base --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans a given text/document snippet |
| `scan_file` | Scans a single file |
| `scan_directory` | Recursively scans a directory (e.g. a RAG knowledge base) (`node_modules`, `.git`, `dist` skipped automatically) |
| `list_patterns` | Lists all supported patterns by category |

---

## Detected Patterns

| Category | Pattern | Severity | What it means |
|---|---|---|---|
| instruction-override | `instruction_override_phrase` | high | A classic override phrase like "ignore/disregard/forget previous instructions" |
| role-spoofing | `system_role_spoof` | medium | A fake "System:" role label at the start of a line in the content |
| role-spoofing | `chat_template_marker_injection` | high | Raw chat-template control tokens (`<\|im_start\|>`, `[INST]`) in the content |
| hidden-text | `hidden_zero_width_chars` | medium | Zero-width space/word-joiner (U+200B/U+2060) — text hidden from a human reviewer |
| hidden-text | `css_hidden_text_with_instruction` | high | A `display:none`/white-on-white element containing instruction-like language |
| hidden-text | `html_comment_instruction` | high | An HTML comment containing instruction-like language |
| direct-address | `direct_address_to_ai` | medium | The content directly addresses "the AI"/"the assistant" |
| exfiltration | `exfiltration_url_template_in_image` | high | A markdown image URL with a `{{...}}`/`${...}` template — a data-exfil beacon |
| exfiltration | `reveal_system_prompt_request` | high | A sentence asking the model to reveal its system prompt |
| exfiltration | `send_data_to_url_instruction` | critical | An explicit instruction ordering the model to send data to an external URL |

These are **heuristic** findings — a static text-pattern scan, not a semantic/intent analysis. Designed for a low false-positive rate (e.g. emoji ZWJ sequences and ordinary `display:none` modals are specifically excluded), but every finding should still be reviewed manually.

---

## Configuration (`guardbee.yml`)

```yaml
prompt-injection-scanner:
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
npm test             # 30 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
