# @guardbee/mcp-prompt-leak-scanner

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server — and a standalone reverse proxy — that catches leaked credentials and PII in **outbound** LLM prompts, before they leave your application.

`secret-scanner` finds secrets sitting in your codebase. This package finds secrets and PII that made it into a *runtime prompt* — a support agent that pastes a customer's ticket (email, card number) straight into a system prompt, a debugging session where someone pastes an API key into a chat, an internal tool that forwards raw user input to an LLM without ever checking what's in it. That's a different moment in the pipeline, and a different failure mode than a leaked `.env` file.

> This package sends usage telemetry by default (tool name + short parameters, prompt content and audit findings are never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Your app ──► prompt-leak-scanner (proxy) ──► Real LLM API (OpenAI/Anthropic/...)
                    │
                    ├─ monitor: forward unchanged, log findings
                    ├─ redact:  forward with matches replaced by [REDACTED:<id>]
                    └─ block:   reject the request before it ever reaches the model
```

---

## Two ways to use it

**1. On-demand scanning (MCP tools)** — `scan_text`/`scan_messages`/`scan_file`/`scan_directory`. Ask Claude to check a prompt, a chat-request-body fixture, or a directory of prompt logs before you ship something that builds prompts from user input.

**2. A live reverse proxy (`proxy` CLI command)** — sits between your application and the real LLM API. It buffers and inspects only the **outbound request body** (message/system text), then streams the upstream response straight back unmodified — so SSE/streaming completions pass through untouched; only the prompt going *out* is ever parsed. Point your app's `baseURL` at the proxy instead of the real API and nothing else in your integration needs to change.

```bash
guardbee-prompt-leak-scanner proxy --upstream=https://api.openai.com --port=8788 --mode=redact
# your app: baseURL = http://localhost:8788 instead of https://api.openai.com
```

---

## Detection quality: checksums, not just regex

A bare regex for "11 digits" or "16 digits" would flag order numbers, phone extensions, and timestamps constantly. Every PII pattern that has a real checksum algorithm uses it:

- **TC Kimlik No** — the actual 11-digit Turkish national ID checksum algorithm (not just a digit-count regex)
- **Credit card numbers** — Luhn checksum
- **IBAN** — ISO 7064 MOD97-10 checksum

A random 11-digit number has roughly a 1-in-10 chance of passing the TC Kimlik checksum by coincidence — regex alone would be far noisier. Credential patterns (API keys, JWTs, private keys) are matched against real provider-specific prefixes/structure (`sk-`, `AKIA`, `ghp_`, `-----BEGIN...PRIVATE KEY-----`, JWT's three-segment base64url shape), the same low-false-positive approach `secret-scanner` uses.

**Findings never echo the real value.** A finding's `maskedMatch` shows only the first 3 and last 2 characters (`sk-…wx`) — logging or displaying the very thing you just caught would defeat the point. The proxy's audit events go further: they record which pattern fired and where, never the matched text itself.

---

## Features

- **13 patterns, 4 categories**: credential (9), financial-pii (2, checksum-validated), national-id (1, checksum-validated), contact-pii (2)
- **Chat-body aware** — understands OpenAI/Anthropic-style `messages[].content` (string or content-block array) and `system` fields, not just flat text
- **Live reverse-proxy mode** with monitor/redact/block policies — request-only inspection, response streamed through untouched
- Masked findings and credential-free audit events — the tool never becomes a second copy of the leak
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 29 unit tests — checksum validators verified against known-good/known-bad test vectors, proxy tested against a real local HTTP client/server round trip (not just in-process mocks) in all three modes

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-prompt-leak-scanner": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-prompt-leak-scanner"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-prompt-leak-scanner scan ./prompt-fixtures --fail-on=high --format=sarif > results.sarif
```

### CLI (live proxy)

```bash
npx @guardbee/mcp-prompt-leak-scanner proxy --upstream=https://api.openai.com --mode=block --fail-on-severity=critical
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans a raw text string |
| `scan_messages` | Scans an OpenAI/Anthropic-style chat request body object |
| `scan_file` | Scans a single file (plain text, or a JSON request-body fixture — auto-detected) |
| `scan_directory` | Recursively scans a directory of prompt logs/fixtures |
| `list_patterns` | Lists all supported patterns by category |

---

## Detected Patterns

| Category | Pattern | Severity |
|---|---|---|
| credential | OpenAI / Anthropic / Google / Stripe API key, AWS access key ID, GitHub PAT, Slack token, PEM private key block | critical |
| credential | JWT | high |
| financial-pii | Credit card number (Luhn-validated) | high |
| financial-pii | IBAN (mod-97 validated) | high |
| national-id | TC Kimlik No (checksum-validated) | high |
| contact-pii | Email address | medium |
| contact-pii | Turkish phone number | medium |

---

## Configuration (`guardbee.yml`)

```yaml
prompt-leak-scanner:
  fail-on: high       # any | critical | high | medium | low | none
  max-files: 5000
  exclude:
    - "fixtures/known-safe/"
```

---

## Limitations (by design)

- The proxy only inspects the **request** body; it does not parse or modify streaming SSE responses — those are piped through untouched.
- Only `messages[].content` (string or `{type:"text"}` content blocks) and top-level `system` are extracted from a chat body; provider-specific fields outside that shape aren't scanned.
- This is pattern/checksum-based detection, not a general-purpose NER/PII model — it won't catch PII that doesn't match a known structural pattern (e.g. a name or street address in free text).

---

## Development

```bash
npm run build
npm test             # 29 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
