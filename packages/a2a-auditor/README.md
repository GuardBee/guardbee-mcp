# @guardbee/mcp-a2a-auditor

[![Listed on AgentHub](https://myagenthub.cn/badge/io.github.4hmetuyar/a2a-auditor)](https://myagenthub.cn/p/io.github.4hmetuyar/a2a-auditor)

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans an agent's own **Agent2Agent (A2A) protocol implementation** for anti-patterns — not invented from the spec text, but read directly out of the reference SDKs (`@a2a-js/sdk`, `a2a-sdk`) and their own official sample code.

A2A doesn't have an MCP-style "Security Considerations" section yet to quote. So instead of guessing, this package's patterns come from three things found in the reference SDK source itself: the official push-notification sender fetches a client-supplied webhook URL with no host check at all, the official *sample* agent ships with an empty security scheme and a literal `noAuthentication` request handler, and the Python SDK's `AgentCard(...)` constructor treats its two security kwargs as fully optional — silently meaning "no auth" if you don't pass them.

> This package sends usage telemetry by default (tool name + short parameters, scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► a2a-auditor ──► Your A2A agent's source
              │
              ├─ webhook-ssrf            (push-notification webhook URL fetched with no allowlist)
              ├─ missing-authentication  (Agent Card / request handler requires no auth at all)
              └─ credential-exposure     (literal credential inside publicly-served Agent Card metadata)
```

---

## Why these three specifically

**Webhook SSRF** because the reference `DefaultPushNotificationSender` does exactly `const url = pushConfig.url; ... fetch(url, ...)` — `pushConfig.url` is set by whichever client subscribed to task updates, and the SDK fetches it with zero host validation. A caller can point a server running this code at an internal service, a cloud metadata endpoint, or anything else reachable from the server's network.

**Missing authentication** because the SDK's own sample agent (`src/samples/agents/movie-agent`) ships with `securitySchemes: {}`, `securityRequirements: []`, and `userBuilder: UserBuilder.noAuthentication` — a copy-paste-friendly shape that looks like a placeholder but is, functionally, "accept every request from anyone." The Python SDK has the same failure mode via absence rather than an explicit empty value: `AgentCard(...)` never requires `security_schemes`/`security_requirements`, so a real agent built by following the reference examples can end up with no authentication and no error telling you so.

**Credential exposure** because an Agent Card is served publicly — anyone who can reach `/.well-known/agent-card.json` (or the equivalent discovery response) can read it, no authentication required to *fetch the card itself*. A literal API key sitting in that JSON is effectively public.

---

## Features

- **3 categories**: webhook-ssrf, missing-authentication, credential-exposure
- **Both TypeScript and Python A2A code** — the SDKs use different idioms for the same failure (empty object vs. absent kwargs), so this checks both, not just one language
- Two of the six checks track data flow across a few lines instead of matching a single call site: the webhook check follows a `url` variable back to a `pushConfig.url`-shaped assignment before flagging the `fetch()` that uses it, and the credential check extracts the full Agent Card object span (brace-matched) before searching inside it for a literal secret — so it doesn't just flag any `apiKey:` anywhere in the file
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 18 unit tests — a positive and a negative (false-positive) scenario for every pattern, including a regression test for a real bug found during development (`\bAgentCard` doesn't match inside `movieAgentCard` — no word boundary between a lowercase and uppercase letter — fixed to match the class name as a suffix instead). End-to-end verified against fixtures with all patterns deliberately planted in both TypeScript and Python (caught all of them), and against the entire guardbee-mcp monorepo (461 files — zero findings in any real code; the only matches were this package's own test fixtures, pattern-definition source, and manifest description text)

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-a2a-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-a2a-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-a2a-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans a code snippet |
| `scan_file` | Scans a single file |
| `scan_directory` | Recursively scans a directory |
| `list_patterns` | Lists all supported patterns by category |

---

## Detected Patterns

| Category | Pattern | Severity |
|---|---|---|
| webhook-ssrf | `webhook_url_direct_fetch_no_allowlist` | critical |
| webhook-ssrf | `webhook_url_indirect_fetch_no_allowlist` | critical |
| missing-authentication | `no_authentication_user_builder` | critical |
| missing-authentication | `empty_agent_card_security` | high |
| missing-authentication | `python_agent_card_no_auth` | high |
| credential-exposure | `agent_card_credential_in_metadata` | high |

---

## Configuration (`guardbee.yml`)

```yaml
a2a-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## Limitations (by design)

- **Heuristic, not a full A2A conformance test.** This finds specific anti-patterns taken from the reference SDK's own source, not a live protocol conformance check against a running agent. A2A is a young, fast-moving spec — new failure modes will show up over time that aren't covered here yet.
- **The data-flow checks (indirect webhook fetch, Agent Card credential span) use a bounded text window and bracket-matching**, not a real parser — a `url` variable assigned through a more indirect chain (e.g. passed through a helper function) won't be traced correctly, and neither will an Agent Card object spread across multiple `Object.assign()`-style merges instead of one literal.
- **Naming-convention dependent.** The checks look for identifiers shaped like `pushConfig.url`, `*AgentCard`, `UserBuilder.noAuthentication` — code that renames these away from the SDK's own conventions won't be recognized, the same limitation every pattern-based scanner in this family has.

---

## Development

```bash
npm run build
npm test             # 18 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
