# @guardbee/mcp-security-proxy

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md) | [🇨🇳 中文](ZH.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A transparent security layer that sits in front of any MCP server. Blocks prompt injection attacks, masks PII in responses, and writes every request to an immutable audit log.

> This package sends usage telemetry to GuardBee by default (tool name + short parameters, see [`@guardbee/mcp-telemetry`](../telemetry/README.md)) — separate from and independent of its own local audit log. Disable with `GUARDBEE_TELEMETRY=0`.

```
Claude ──► MCP Security Proxy ──► Any MCP Server
                │
                ├─ Prompt injection detection  (27 rules, EN + TR)
                ├─ PII + secret masking        (TC, VKN, IBAN, card, phone, 22 key formats)
                ├─ Block or warn mode
                ├─ Toxic-flow (lethal trifecta) blocking
                └─ Hash-chained audit log
```

---

## Features

- **Prompt Injection Protection** — 27 rules in English and Turkish; precise ones block, generic phrases only warn
- **Tool-result injection** — the same patterns applied to tool results, tagged MCP06:2025. Block mode replaces the result; warn mode prepends a warning
- **Session tool pin** — the first `tools/list` is pinned. A later description or schema change is a rug pull (MCP03:2025). Block mode keeps serving the pinned definition and refuses the drifted call
- **PII Masking** — TC Kimlik No, VKN, IBAN, card and phone numbers (checksum-validated), email, 22 provider key formats, private keys and connection strings are masked in responses
- **Block / Warn Mode** — each interceptor can independently run in blocking or warning mode
- **Audit Log** — configurable log written to console or a file
- **Gateway mode** — several MCP servers behind one proxy, one YAML policy (allow / deny / mask / warn)
- **Toxic-flow blocking** — tracks the lethal trifecta across servers and blocks the egress call that would complete it
- **Zero Code Changes** — attaches in front of any existing MCP server

---

## Quick Start

```bash
npm install -g @guardbee/mcp-security-proxy
```

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "secure-filesystem": {
      "command": "npx",
      "args": [
        "-y", "@guardbee/mcp-security-proxy",
        "--", "npx", "-y",
        "@modelcontextprotocol/server-filesystem", "/tmp"
      ]
    }
  }
}
```

> The proxy launches whatever comes after `--` as the target MCP server.

---

## Gateway Mode: Several Servers, One Policy

Put every MCP server behind one proxy with a `guardbee-proxy.yaml`. `init` does the move for you:

```bash
npx -y @guardbee/mcp-security-proxy@^1 init --client claude-desktop   # or cursor, claude-code, --file ./mcp.json
```

It moves each stdio server into `~/.guardbee/guardbee-proxy.yaml` (mode 0600), backs up the client config and points it at the proxy. HTTP servers stay as they are and are reported, because they would bypass the policy. `--dry-run` prints both files without writing. Or by hand:

```json
{
  "mcpServers": {
    "guardbee": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-security-proxy@^1", "--config", "/path/to/guardbee-proxy.yaml"]
    }
  }
}
```

```yaml
version: 1
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }   # read from the environment
  postgres:
    command: npx
    args: ["-y", "@guardbee/mcp-db-gateway"]

labels:                       # override the heuristic labels
  github__get_issue: [untrusted]
  github__create_pull_request: [egress]

rules:                        # first match wins
  - id: no-deletes
    match: { tool: "postgres__delete_*" }
    action: deny              # allow | deny | mask | warn | approve
  - match: { tool: "postgres__query", args: { table: "salaries" } }   # dotted path → value, strings are globs
    action: mask
    mask: { fields: [salary, iban] }   # blank these JSON keys
  - match: { label: destructive }
    action: approve           # ask the person first

taint:
  mode: strict                # strict | approve | warn | off

audit:
  sink: file
  filePath: ./guardbee-audit.jsonl
```

- Tools and prompts appear as `<upstream>__<tool>`.
- **Toxic flow (lethal trifecta):** each tool is labeled `untrusted`, `sensitive`, `egress` or `destructive` (name/description heuristics, overridable under `labels`). Once a session has read untrusted content (an `untrusted` tool or any resource) and sensitive data (a `sensitive` tool or any PII in a result), an `egress` call is blocked in `strict` mode and only logged in `warn` mode. The check spans servers: an issue read from GitHub plus a customer record from a CRM blocks a webhook on a third server.
- **Rules** match on `tool` (glob), `upstream`, `label`, `session` (`clean` | `tainted`) and `args`. `mask` forces PII masking for that tool even when masking is off, and `mask.fields` also blanks the named JSON keys in text and `structuredContent`. A rule's `allow` does not skip the toxic-flow check; relabel the tool instead.
- **Approval:** `approve` (a rule action, or `taint.mode: approve` for toxic flows) shows the person a yes/no form through MCP elicitation, with the tool, the reason and the arguments. Anything but an explicit yes — decline, cancel, no answer within `approval.timeoutSeconds` (default 120) — blocks the call. A client without elicitation support cannot approve, so the call is blocked with a message saying so.
- **Approval in the dashboard:** with `approval.channels: [elicitation, dashboard]` and `audit.dashboard` set, a client that cannot show a prompt no longer blocks the call outright. The request goes to the GuardBee dashboard (MCP Gateway page) with the arguments PII-masked, workspace owners and admins get a notification, and the proxy holds the call until someone approves or denies it there or `timeoutSeconds` passes. Channels are tried in order; the first one that can ask gives the answer.
- **Tokenize:** with `interceptors.piiMasking.mode: tokenize` the model sees `<pii:tc_kimlik:7f3a9b21>` instead of the value and can still pass it to another tool: the proxy puts the real value back on the way to that server. Tokens live in memory for the session only, and are not turned back into values for an `egress` tool unless `piiMasking.detokenizeForEgress: true`.
- **Prompts** (`prompts/get`) get the same injection scan and PII masking as tool results.
- `interceptors.definitionDrift.recheck: on-change` skips the per-call `tools/list` and re-checks only after a server sends `tools/list_changed`, which the proxy also passes on to the agent.
- **Audit log** is hash-chained. By default it stores a SHA-256 of the arguments instead of the arguments, and no results; set `audit.includePayloads: true` to log them. Check a log with `guardbee-proxy verify-audit ./guardbee-audit.jsonl`.
- `guardbee-proxy validate --config guardbee-proxy.yaml` checks a config without starting any server.
- Without `--config`, the proxy also picks up `./guardbee-proxy.yaml` or `GUARDBEE_PROXY_CONFIG=<file>.yaml`.

The single-server `--` form above keeps its 0.x behavior: tool names are not prefixed, payloads are logged, and a toxic flow is only logged as a warning.

---

## Remote Mode (HTTP)

The proxy can run as a shared network service instead of a subprocess of one client. Agents connect over Streamable HTTP, and upstreams can be remote Streamable HTTP servers too.

```yaml
version: 1
listen:
  transport: http              # stdio (default) | http
  host: 0.0.0.0                # 0.0.0.0 in a container; 127.0.0.1 on a laptop
  port: 8787
  path: /mcp
  apiKeys: ["${GUARDBEE_PROXY_KEY}"]   # agents send Authorization: Bearer <key>
  maxSessions: 100
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  linear:
    url: https://mcp.linear.app/mcp     # a Streamable HTTP upstream
    headers: { Authorization: "Bearer ${LINEAR_TOKEN}" }
audit:
  sink: file
  filePath: /var/log/guardbee/audit.jsonl
  dashboard:
    url: https://app.guardbee.ai/api/v1/gateway/events
    apiKeyEnv: GUARDBEE_API_KEY        # workspace API key with the gateway.write scope
```

- **Sessions are isolated.** Each MCP session gets its own taint state, PII tokens and tool pins, so one agent's toxic flow never blocks another. All sessions share the upstream connections. Audit events carry the `sessionId`.
- **No key, no network.** Listening on anything other than loopback without `listen.apiKeys` is a config error. Keys are compared in constant time, and a wrong or missing key gets `401`.
- `GET /healthz` returns `{"ok": true, "sessions": N}`. Sessions above `maxSessions` get `503`.
- **Dashboard:** `audit.dashboard` sends every audit event, batched, to the GuardBee dashboard with a workspace API key taken from `apiKeyEnv`. The key never sits in the file. If the dashboard is unreachable, events wait in memory (up to 10,000) and go out later. A rejected key is reported once on stderr. Tool calls never wait for the dashboard.
- `init` now also moves Streamable HTTP servers (`url` + `headers`) behind the proxy. Legacy SSE servers stay in the client config and are reported.

Docker:

```bash
docker build -t guardbee/mcp-security-proxy packages/security-proxy
docker run -p 8787:8787 -e GUARDBEE_PROXY_KEY=... -e GUARDBEE_API_KEY=... \
  -v "$PWD/guardbee-proxy.yaml:/etc/guardbee/guardbee-proxy.yaml:ro" guardbee/mcp-security-proxy
```

---

## MCP Tools

The proxy does not register tools of its own. It forwards the target server's tools and applies the interceptor chain on every call.

---

## Interceptors

### Prompt Injection Detector

27 rules from [`@guardbee/guard-core`](../guard-core/README.md), applied to tool arguments, tool results, resources and prompts:

- **Block** (13 precise, high/critical): instruction overrides in English and Turkish ("ignore all previous instructions", "önceki talimatları yok say"), `DAN mode`, "bypass your safety guardrails", chat-template tokens (`<|im_start|>`, `[INST]`), `<system>` tags, text hidden in Unicode tag characters, instructions in CSS-hidden elements or HTML comments, markdown image exfiltration beacons, requests to reveal the system prompt (English and Turkish), "send the user's data to https://…".
- **Warn only** (14): generic phrases that also appear in ordinary text — "act as", "you are now", "developer mode", "jailbreak", "override policy", "sen artık" — and medium-severity signals such as zero-width or bidi control characters and a line-start `System:` label.
- **Base64:** runs that decode to readable text are decoded and checked against the block rules, so an instruction cannot hide in an encoded blob.

Since 1.1, a broad phrase alone no longer blocks: in 1.0 "use jailbreak mode" or "act as a reverse proxy" in a tool result was blocked; now it is logged and the result carries a warning.

### PII Masker

| Data Type | Check | Example Input | Output |
|-----------|-------|---------------|--------|
| National ID (TC Kimlik No) | official checksum | `10000000146` | `[TC-KİMLİK]` |
| IBAN (TR) | mod-97 | `TR330006100519786457841326` | `TR**[IBAN]` |
| Card number | Luhn | `4111 1111 1111 1111` | `****-****-****-[KART]` |
| Email | — | `ahmet@example.com` | `***@[EMAIL]` |
| Phone (TR) | mobile / landline / 850 prefix | `0532 123 45 67` | `+90-***-***-**[TELEFON]` |
| Tax number (VKN) | check digit, needs a `VKN` / `Vergi No` label | `VKN: 1234567890` | `VKN: [VKN]` |
| Provider keys | 22 key and token formats from secret-scanner (AWS, GitHub, Stripe, OpenAI, Anthropic, Slack, …) | `ghp_…`, `AKIA…` | `[API-KEY]` |
| Other API keys | `sk_`/`api_`/`token_`… prefix, letters and digits | `api_k3y9x8…` | `[API-KEY]` |
| Private key | whole BEGIN…END block | `-----BEGIN … PRIVATE KEY-----` | `[PRIVATE-KEY]` |
| Connection string | user:password in the URL (localhost excluded) | `postgres://app:pw@db/prod` | `[CONNECTION-STRING]` |
| JWT | — | `eyJhbGc...` | `[JWT-TOKEN]` |

A number that fails its checksum (an order number, a tracking code) is left as is.

---

## Configuration

Configurable via environment variables:

| Variable | Default | Description |
|----------|-----------|----------|
| `PROXY_MODE` | `block` | `block` or `warn` |
| `PROXY_LOG` | `console` | `console` or `file` |
| `PROXY_LOG_PATH` | `./proxy-audit.jsonl` | Log file path |
| `PROXY_PII_MASK` | `true` | Enable PII masking |
| `PROXY_INJECTION_CHECK` | `true` | Enable injection checking |

---

## License

MIT — [GuardBee](https://guardbee.ai)
