# @guardbee/mcp-security-proxy

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-security-proxy.svg)](https://www.npmjs.com/package/@guardbee/mcp-security-proxy)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/security-proxy/LICENSE)

A transparent security layer that sits in front of any MCP server. Blocks prompt injection attacks, masks PII in responses, and writes every request to an immutable audit log.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

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
- **PII Masking** — TC Kimlik No, VKN, IBAN, card and phone numbers (checksum-validated), passport, SGK, MERSİS, date of birth, postal and KEP addresses, email, opt-in IP/MAC/plates, 22 provider key formats, private keys and connection strings are masked in responses
- **Block / Warn Mode** — each interceptor can independently run in blocking or warning mode
- **Audit Log** — configurable log written to console or a file
- **Gateway mode** — several MCP servers behind one proxy, one YAML policy (allow / deny / mask / warn)
- **Toxic-flow blocking** — tracks the lethal trifecta across servers and blocks the egress call that would complete it
- **LLM API gateway** — OpenAI- and Anthropic-compatible endpoints: gateway keys instead of provider keys, PII masking and injection checks on prompts, token and spend budgets, usage and cost in the audit log
- **Coding-agent hooks** — `guardbee-hook` applies the same policy to Claude Code's and Cursor's own shell, file and web tools
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

tools:                        # what the agent sees (globs on <upstream>__<tool>)
  hide: ["*__delete_*"]
  descriptions:
    github__create_issue: "Create an issue in acme/* repositories only."

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
  basis: capability           # capability | data — data: block only egress calls that carry sensitive data

interceptors:
  anomaly:                    # off unless set; limits per session, sliding window
    enabled: true
    action: warn              # warn | block
    callBurst: { count: 60, windowSeconds: 60 }

audit:
  sink: file
  filePath: ./guardbee-audit.jsonl
```

- Tools and prompts appear as `<upstream>__<tool>`.
- **Toxic flow (lethal trifecta):** each tool is labeled `untrusted`, `sensitive`, `egress` or `destructive` (name/description heuristics, overridable under `labels`). Once a session has read untrusted content (an `untrusted` tool or any resource) and sensitive data (a `sensitive` tool or any PII in a result), an `egress` call is blocked in `strict` mode and only logged in `warn` mode. The check spans servers: an issue read from GitHub plus a customer record from a CRM blocks a webhook on a third server.
- **Rules** match on `tool` (glob), `upstream`, `label`, `session` (`clean` | `tainted`) and `args`. `mask` forces PII masking for that tool even when masking is off, and `mask.fields` also blanks the named JSON keys in text and `structuredContent`. A rule's `allow` does not skip the toxic-flow check; relabel the tool instead.
- **Topics (`topics`, `match.topic`):** a rule can name a subject instead of a tool — "nothing about mergers or salaries leaves through this agent". A topic is a list of terms; text is on topic when `minMatches` (default 1) different terms appear. Matching folds case and Turkish letters (`BİRLEŞME` = `birlesme`), and a term may take a suffix (`maaş` finds `maaşları`, `satın alma` finds `satın almayı`); quote a term to match the whole word only (`'"AI"'`). The rule is checked on the call's arguments, and again on what comes back — the tool result, a resource, a prompt — so a subject that only shows up in the answer is caught too: `deny` withholds it, `mask` forces PII masking and `mask.fields`, `warn` logs, `approve` asks (once: not again for the answer of a call it already approved). In the [LLM API gateway](#llm-api-gateway) topic rules apply to the whole prompt, with `tool: llm:<model>`; `approve` refuses there, since an API call has no one to ask.

  ```yaml
  topics:
    - id: ma
      terms: [birleşme, "satın alma", "due diligence", acquisition, merger]
    - id: salary
      terms: [maaş, bordro, payroll, salary]
      minMatches: 1
  rules:
    - { id: no-ma-out,   match: { topic: ma, label: egress }, action: deny }
    - { id: contractors, match: { topic: salary, user: "*@contractor.com" }, action: approve }
    - { id: ma-to-llm,   match: { topic: ma, tool: "llm:gpt-*" }, action: deny }
  ```
- **Tool exposure (`tools`):** `expose` is an allowlist of globs on the name the agent sees (absent: every tool), and `hide` removes tools after it. A hidden tool is left out of `tools/list`, so the model never reads its description (a smaller poisoning surface and fewer tokens), and a call to it is refused and counts toward `anomaly.repeatedBlocks`. `descriptions` replaces a tool's description with one you wrote; drift detection keeps watching the server's own. Unlike a `deny` rule, which refuses at call time, hiding takes the tool out of the agent's view.
- **Tool poisoning at `tools/list` (`interceptors.toolPoisoning`, on by default):** every definition is scanned before the agent sees it — the description (yours, when you wrote one under `tools.descriptions`), parameter descriptions and enum values in the input schema, and the read-only annotation. It catches instructions aimed at the model (`<IMPORTANT>`, "do not tell the user", "ignore previous instructions"), cross-tool shadowing ("when using the X tool, always…"), requests to read `.ssh`/`.env`, hidden zero-width, bidi and ANSI characters, words with Cyrillic or Greek lookalikes, and a `readOnlyHint` that the description contradicts. In `block` mode (default; follows `promptInjection.action` when unset) a tool with a critical or high finding is left out of the list and its calls are refused; medium findings (encoded blobs) only warn. Each finding is logged once as `ruleId: poisoning:<pattern>`. The rules are the ones `@guardbee/mcp-tool-poisoning-scanner` uses, now shared through guard-core.
- **Credentials leaving (`interceptors.egressSecrets`, on by default):** before an `egress` tool runs, the arguments it would actually receive are checked for credentials — provider keys (AWS, GitHub, OpenAI, Anthropic, Stripe, Slack, …), private keys and connection strings with a password; the same fixed-format rules PII masking uses, never the broad keyword ones. Data taint only knows what this session's tools returned; this also catches a key the model got from the prompt, a file or its own context. `block` (default; follows `promptInjection.action` when unset) refuses the call, `warn` logs it; the audit event has the credential masked either way. A PII token stays a token for an egress tool unless `piiMasking.detokenizeForEgress`, so only then is its value checked. `allowTools` exempts tools by glob (a deploy tool that takes a DB URL, say). Personal data is left to PII masking and taint.
- **Sampling (`interceptors.sampling`, off by default):** a server can ask the agent's model for a completion (`sampling/createMessage`) — and a malicious one can use that to smuggle instructions to the model or pull data out. Off, the proxy does not offer sampling to servers at all. On, a request is answered only while one of that server's tool calls is running, by the session that made the call (two sessions calling the same server at once: refused, since it could belong to either); `includeContext` is forced to `none`, so a server never gets the conversation; `maxTokens` is capped (default 1024) and so is the number of requests per call (`maxPerCall`, default 3); the system prompt and messages get the injection scan; `approval: true` asks the person first. The model's answer goes back to the server, so it is treated as egress: a credential or data this session saw blocks it, and personal data is masked. Events use `tool: sampling:<upstream>` and `ruleId: sampling:<check>`. The capability is offered when the proxy starts, so turning it on or off needs a restart.
- **Approval:** `approve` (a rule action, or `taint.mode: approve` for toxic flows) shows the person a yes/no form through MCP elicitation, with the tool, the reason and the arguments. Anything but an explicit yes — decline, cancel, no answer within `approval.timeoutSeconds` (default 120) — blocks the call. A client without elicitation support cannot approve, so the call is blocked with a message saying so.
- **Approval in the dashboard:** with `approval.channels: [elicitation, dashboard]` and `audit.dashboard` set, a client that cannot show a prompt no longer blocks the call outright. The request goes to the GuardBee dashboard (MCP Gateway page) with the arguments PII-masked, workspace owners and admins get a notification, and the proxy holds the call until someone approves or denies it there or `timeoutSeconds` passes. Channels are tried in order; the first one that can ask gives the answer.
- **Data-based taint (`taint.basis: data`):** the default `capability` basis blocks every egress call once a session holds untrusted and sensitive content. With `data`, the proxy keeps hashed fingerprints of what sensitive tools (and PII-bearing results) returned — personal data and credentials, id-like tokens, and runs of words — and treats an egress call as a toxic flow only when its arguments carry that data (12+ words in common, or an exact identifier; PII tokens count as their values) and the session also read untrusted content. The block message names the tool the data came from. Licence text, markdown boilerplate and text that also came back from ordinary results or from 3+ tools are ignored. Fingerprints are hashes, kept in memory per session. Trade-off: a paraphrase or a summary of the data is not caught; keep `capability` where that matters. In `capability` mode the same evidence is added to the block reason when found.
- **Anomaly checks (`interceptors.anomaly`):** behaviour no single call shows, counted per session over a sliding window. `callBurst` — more than 60 tool calls in 60s (a loop, or a denial-of-wallet). `sensitiveSweep` — more than 25 *different* reads of `sensitive` tools in 300s (enumerating a store record by record; re-reading the same record does not count). `destructiveBurst` — more than 5 `destructive` calls in 60s. `repeatedBlocks` — more than 5 calls blocked or declined in 300s (probing the policy; a client that cannot show an approval prompt does not count). Each takes `{ count, windowSeconds }`; the numbers above are the defaults. `warn` logs the first trip of each check; `block` refuses calls over the limit until the window slides, and after repeated blocks refuses every later call in the session. Events are `warn`/`blocked` with `ruleId: anomaly:<check>`, so the dashboard shows them without changes. Off unless configured.
- **Quotas (`quotas`):** caps on tool calls over a fixed window, counted across sessions — where `interceptors.anomaly` watches one session, a quota holds when a user opens ten. Each entry has `match` (`tool` and `user` globs, `upstream`, `label`, `group`; all optional), `limit`, `windowSeconds` and `per`: `user` (default; the OIDC user, or the session without one), `session`, or `gateway` (one budget for everyone, e.g. a paid upstream). Example: `quotas: [{ id: exports, match: { label: egress, group: contractors }, limit: 20, windowSeconds: 3600 }]`. Every matching quota is checked and a call counts against all of them or none; only calls that are about to reach the upstream count, so a call the policy refused does not spend quota. A full quota refuses the call with the time to retry, logs `ruleId: quota:<id>`, and does not count toward `anomaly.repeatedBlocks`. Counters live in the proxy process: several replicas each keep their own.
- **Policy from the dashboard:** `policy: { source: dashboard, refreshSeconds: 60 }` (with `audit.dashboard`) takes labels, rules, taint, approval, defaults and interceptors from the workspace policy edited in the GuardBee dashboard, instead of this file. Upstreams, listen and audit stay local. The proxy fetches it at start and re-checks it with an ETag; an update applies to the next call in every session (labels from the next `tools/list`). With no dashboard policy saved, the dashboard unreachable, or an invalid document, the proxy keeps the local or last good policy — it never runs without one.
- **Documents (`interceptors.documents`, off by default):** images and blobs in tool results, embedded resources and resource reads — PDFs, screenshots, scanned pages — are read with [`@guardbee/mcp-document-scanner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/document-scanner): the PDF text layer, and OCR for images and pages without text when the optional `tesseract.js` (and `@napi-rs/canvas` for scanned PDFs) are installed. A document holding personal data or a credential is replaced by a notice in `block` mode (`ruleId: documents:pii`) or logged in `warn` mode; its counts go into `piiHits` and taint the session like PII in text. A document that could not be read (OCR not installed, over `maxBytes`) is logged as `documents:unread`. `{ enabled: true, action: block, ocr: true, maxBytes: 26214400 }`.
- **Personal-data counts:** tool responses and resource reads that contained PII carry `piiHits`, a count per category (`tc_kimlik`, `vkn`, `iban`, `credit_card`, `email`, `phone_tr`; credentials as `secret`). Counts only, never the values, and counted even with masking off. The dashboard builds its KVKK report from them.
- **Tokenize:** with `interceptors.piiMasking.mode: tokenize` the model sees `<pii:tc_kimlik:7f3a9b21>` instead of the value and can still pass it to another tool: the proxy puts the real value back on the way to that server. Tokens live in memory for the session only, and are not turned back into values for an `egress` tool unless `piiMasking.detokenizeForEgress: true`.
- **Prompts** (`prompts/get`) get the same injection scan and PII masking as tool results.
- `interceptors.definitionDrift.recheck: on-change` skips the per-call `tools/list` and re-checks only after a server sends `tools/list_changed`, which the proxy also passes on to the agent.
- **Audit log** is hash-chained. By default it stores a SHA-256 of the arguments instead of the arguments, and no results; set `audit.includePayloads: true` to log them. Check a log with `guardbee-proxy verify-audit ./guardbee-audit.jsonl`.
- `guardbee-proxy validate --config guardbee-proxy.yaml` checks a config without starting any server.
- Without `--config`, the proxy also picks up `./guardbee-proxy.yaml` or `GUARDBEE_PROXY_CONFIG=<file>.yaml`.

The single-server `--` form above keeps its 0.x behavior: tool names are not prefixed, payloads are logged, and a toxic flow is only logged as a warning.

---

## Security Reports

`guardbee-proxy report` turns the audit log into a periodic report for a security team or an auditor: totals, the findings grouped and mapped to **OWASP Top 10 for LLM Applications (2025)** and **MITRE ATLAS**, personal-data counts, the rules and tools that blocked most, and the state of the hash chain. Payloads are never in it — only counts and the logged reasons.

```bash
openssl genpkey -algorithm ed25519 -out guardbee-report.key          # once; keep it private
openssl pkey -in guardbee-report.key -pubout -out guardbee-report.pub
guardbee-proxy report ./guardbee-audit.jsonl --days 30 --lang tr --key guardbee-report.key --out ekim.html
guardbee-proxy report ./guardbee-audit.jsonl --from 2026-10-01 --to 2026-11-01 --format json --out october.json
guardbee-proxy verify-report ekim.html --pubkey guardbee-report.pub
```

| Category | OWASP LLM Top 10 | MITRE ATLAS |
|---|---|---|
| Prompt injection in arguments and prompts | LLM01 | AML.T0051.000, AML.T0054 |
| Instructions hidden in tool results, resources and prompts | LLM01, LLM05 | AML.T0051.001 |
| Attempts to extract the system prompt | LLM07, LLM01 | AML.T0056 |
| Poisoned tool definitions | LLM01, LLM03 | AML.T0051.001, AML.T0053 |
| Tool definitions changed after approval (rug pull) | LLM03 | AML.T0010, AML.T0053 |
| Sensitive data or credentials on their way out (toxic flows, credential egress, documents) | LLM02, LLM06 | AML.T0057 |
| Calls refused or held by policy | LLM06 | AML.T0053 |
| Bursts, quotas and budgets | LLM10 | AML.T0029, AML.T0034 |

- Formats: Markdown (default), self-contained HTML (light and dark), JSON; `--lang en|tr`.
- **Integrity**: the report carries the SHA-256 of its canonical JSON and the hash of the last audit event in the period, so it is tied to the hash chain. With `--key` (Ed25519, PEM) it is signed and carries the public key. `verify-report` checks a `.json`, `.html` or `.md` report; pass `--pubkey` to pin the signer — the embedded key alone only proves the report was not changed after signing, not who signed it.
- A broken hash chain is reported in the report and on stderr.
- The mapping lives in `@guardbee/guard-core` (`classifyEvent`, `THREAT_CATEGORIES`) and is shown by `@guardbee/mcp-threat-rules`' `framework_map` tool.

## Observability (OpenTelemetry)

Every tool call is a span named `tools/call <tool>` (kind SERVER) with the MCP semantic-convention attributes — `mcp.method.name`, `gen_ai.tool.name`, `gen_ai.operation.name: execute_tool`, `mcp.session.id`, `enduser.id` (OIDC) — plus `guardbee.upstream`, `guardbee.labels` and `guardbee.pii_hits`. The call to the upstream is a child span (kind CLIENT, `server.address` = upstream). Every audit event of the call — blocks, toxic flows, approvals, warnings, a server's sampling requests — is a span event (`guardbee.blocked`, … with `guardbee.rule_id` and `guardbee.reason`), and a blocked call carries `guardbee.blocked: true`. Arguments and results are never put on spans.

The proxy depends only on `@opentelemetry/api`, so without an SDK the spans cost nothing. To export over OTLP/HTTP, install the SDK next to the proxy and set the standard environment:

```bash
npm i -g @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com:4318
export OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer …"   # if your collector needs it
export OTEL_SERVICE_NAME=guardbee-gateway                      # default: guardbee-security-proxy
```

The Docker image already has the SDK. `OTEL_SDK_DISABLED=true` or `OTEL_TRACES_EXPORTER=none` keeps it off, and a process that registered its own SDK first (zero-code instrumentation through `NODE_OPTIONS`) keeps that one.

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
  oidc:                       # and/or: users sign in with your identity provider
    issuer: https://login.acme.com
    audience: guardbee-gateway
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
- **No key, no network.** Listening on anything other than loopback without `listen.apiKeys` or `listen.oidc` is a config error. Keys are compared in constant time, and a wrong or missing key gets `401`.
- **Directory groups (`listen.ldap`):** LDAP / Active Directory groups are added to the groups a caller already has — an OIDC user, or an LLM gateway key's user — so `group` matches in rules, quotas, `llm.access` and budgets can use the groups your organisation already maintains. The directory never makes a caller known: authentication stays with API keys, OIDC or gateway keys.

  ```yaml
  listen:
    ldap:
      url: ldaps://dc.acme.com                # certificates verified; caFile for a private CA
      bindDn: "CN=svc-guardbee,OU=Service,DC=acme,DC=com"
      bindPasswordEnv: LDAP_BIND_PASSWORD
      baseDn: "DC=acme,DC=com"
      userFilter: "(|(mail={user})(userPrincipalName={user}))"   # {user} is escaped (RFC 4515)
      groupAttribute: memberOf                 # AD; or groupSearch: { baseDn, filter: "(member={dn})", nameAttribute: cn }
      groupName: cn                            # CN=Platform Eng,OU=… → "Platform Eng"; dn keeps the DN
      cacheSeconds: 300
      onError: deny                            # directory down: 503 (default) | token-groups: go on without it
  ```

  SAML is not a proxy setting: MCP and the LLM endpoints authenticate with bearer tokens, and identity providers that speak SAML (Entra ID, Okta, ADFS, Keycloak) also issue OIDC tokens — use `listen.oidc` with them, and `listen.ldap` for groups the token does not carry.
- **Users (`listen.oidc`):** the proxy accepts JWTs from your OpenID Connect provider (Okta, Entra ID, Auth0, Keycloak, Google…) next to or instead of API keys. It checks the signature against the issuer's JWKS (found through its discovery document, or `jwksUri`), the issuer, the `audience` (required: a token minted for another service is refused) and the lifetime. The user comes from `userClaim` (default `sub`; `email` is common) and the groups from `groupsClaim` (default `groups`, a list or a space-separated string). Rules can match `user` (glob, e.g. `"*@contractor.com"`) and `group`, and every audit event carries `user`. A session belongs to the user who opened it: another user's token gets `403` on it. A `401` carries `WWW-Authenticate: Bearer resource_metadata=…`, and `/.well-known/oauth-protected-resource` (RFC 9728) names the issuer, so MCP clients that implement the authorization spec find where to sign in; behind a reverse proxy set `oidc.resource` to the public URL.
- **SIEM export (`audit.exporters`):** every audit event also goes, batched and off the request path, to Splunk, Elasticsearch/OpenSearch or a syslog collector. Credentials come from environment variables; events are the same hashed, payload-free (unless `includePayloads`) events as the local log.

  ```yaml
  audit:
    exporters:
      - { type: splunk,  url: "https://splunk:8088/services/collector/event", tokenEnv: SPLUNK_HEC_TOKEN, index: security }
      - { type: elastic, url: "https://es:9200", index: guardbee-audit, apiKeyEnv: ES_API_KEY }   # or usernameEnv / passwordEnv
      - { type: syslog,  host: siem.acme.internal, port: 6514, protocol: tls, format: cef, caFile: /etc/ssl/acme-ca.pem }
  ```

  Splunk gets HEC events (`sourcetype: guardbee:audit`). Elasticsearch gets `_bulk` `create` operations with the event hash as `_id`, so a retried batch never duplicates (a `409` counts as sent), and `@timestamp`. Syslog is RFC 5424 over UDP, TCP or TLS (certificates always verified; `caFile` for a private CA), with octet-counting (default) or newline framing, facility 13 (log audit) by default and the message as CEF (default) or JSON. CEF puts `act`, `suser`, `rt`, `msg` and `tool` / `upstream` / `ruleId` / `sessionId` / `piiHits` / `labels` in `cs1`–`cs6`; severity 8 for `blocked` and `toxic_flow`, 5 for `warn` and `approval`, 3 otherwise. Each destination keeps its own queue (up to 10,000 events): a SIEM that is down gets the events later; one that refuses them (`401`, a mapping error) is reported once on stderr.
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

## LLM API Gateway

In HTTP mode the proxy can also stand between your apps and the model providers. Apps point their SDK's base URL at the proxy and use a gateway key; the real provider keys stay in the proxy's environment and never reach code, laptops or CI.

```yaml
version: 1
listen: { transport: http, host: 0.0.0.0, port: 8787 }
upstreams: {}                    # MCP servers are optional when llm is set
llm:
  path: /v1                      # POST /chat/completions, /responses, /embeddings, /messages; GET /models
  providers:
    openai:    { api: openai,    baseUrl: https://api.openai.com/v1, apiKeyEnv: OPENAI_API_KEY }
    anthropic: { api: anthropic, baseUrl: https://api.anthropic.com, apiKeyEnv: ANTHROPIC_API_KEY }
    local:     { api: openai,    baseUrl: http://ollama:11434/v1,    apiKeyEnv: OLLAMA_KEY }
  routes:                        # first match wins; a request only goes to a provider of its own API
    - { model: "gpt-*",    provider: openai }
    - { model: "claude-*", provider: anthropic }
    - { model: "llama*",   provider: local }
    - { model: "gpt-4o-internal", provider: openai, masking: off }   # explicit passthrough, audited
  keys:                          # gateway keys, one per person or app (values from the environment)
    - { keyEnv: GB_KEY_ALICE,   user: alice@acme.com, groups: [eng] }
    - { keyEnv: GB_KEY_BILLING, user: billing-svc,    groups: [apps] }
  pricing:                       # USD per 1M tokens, for cost in the audit log and costUsd budgets
    "gpt-4o":   { input: 2.5, output: 10 }
    "claude-*": { input: 3,   output: 15 }
  budgets:
    - { id: per-user-daily, per: user,    windowSeconds: 86400, costUsd: 20 }
    - { id: contractors,    per: user,    windowSeconds: 3600,  requests: 100, match: { group: contractors } }
    - { id: team-tokens,    per: gateway, windowSeconds: 86400, tokens: 5000000, match: { model: "gpt-*" } }
  access:                        # which models a caller may ask for; matching entries add up
    - { group: contractors, allow: ["gpt-4o-mini"] }
    - { user: "*@acme.com", allow: ["gpt-*", "claude-*", "llama*"] }
  accessDefault: allow           # for callers no entry matches: allow | deny
  sensitive:                     # prompts with personal data go to your own model instead
    model: llama3.1              # needs a route for the request's API, or the request is refused
    on: { pii: true, categories: [tc_kimlik, iban, passport], topics: [ma] }
    mask: false                  # the data stays in-house, so it is not masked (true: keep masking)
  maskResponses: false           # also mask PII the model writes (prompts are always checked)
  timeoutSeconds: 120
  maxTextChars: 2000000          # longest single text the proxy masks; longer → 413
interceptors:
  piiMasking: { enabled: true, mode: tokenize }
```

```python
from openai import OpenAI
client = OpenAI(base_url="https://guardbee.acme.internal/v1", api_key=os.environ["GB_KEY"])
```

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ baseURL: "https://guardbee.acme.internal", apiKey: process.env.GB_KEY });
```

What every request goes through, in order:

1. **Key.** `Authorization: Bearer` (OpenAI SDKs) or `x-api-key` (Anthropic SDKs). A gateway key from `llm.keys` gives the user and groups; otherwise `listen.apiKeys` and `listen.oidc` tokens are accepted too. When `llm.keys` is set and `listen` has no keys, an unknown key is always refused — even on loopback.
2. **Route and access.** The model name picks the provider; a model no route serves gets `404`. `llm.access` decides which models the caller may ask for: every entry matching the user (glob) or a group adds its model globs; with no entry matching, `accessDefault` applies. A refused model gets `403` (`ruleId: llm:access`), and `GET /models` lists only the caller's models.
3. **Prompt injection** (`interceptors.promptInjection`) in user and tool messages. The app's own system prompt and the model's earlier turns are not scanned.
4. **Credentials** (`interceptors.egressSecrets`) anywhere in the prompt: provider keys, private keys and connection strings are blocked (`403`) before they reach the provider.
5. **Sensitive routing** (`llm.sensitive`). When the prompt holds personal data (optionally only some `categories`) or one of the listed `topics`, the request goes to `sensitive.model` — an Ollama, vLLM or llama.cpp model you run — instead of the model asked for. The audit log gets a `warn` event with `ruleId: llm:route:sensitive` naming both models and why, so routed requests show up in the dashboard, and the usage event carries `llm.routedFrom`. If the local model has no route for the request's API (an Anthropic request with only an OpenAI-compatible local model), the request is refused rather than sent to the provider it was meant to avoid. Budgets count the routed model.
6. **Budgets.** Requests, tokens and USD per user (or per key) or for the whole gateway, over fixed windows. A request is admitted while every matching budget has room; tokens and cost are known only after the answer, so the call that crosses a limit completes and the next one gets `429` with `Retry-After`.
7. **PII** (`interceptors.piiMasking`) in message text, tool-call arguments and tool results is masked, or with `mode: tokenize` replaced by tokens the proxy turns back into real values in the answer — the provider never sees them, the user does. The text of Anthropic `document` blocks with a text or content source is masked too. Image data, ids and tool names are left alone; content the proxy cannot read is refused (see [Failure behavior](#failure-behavior)).
8. **Audit.** A `tool_call` event (`tool: llm:<model>`, `upstream: <provider>`, `labels: [llm]`, `user`, `piiHits`) and a `tool_response` event with `llm: { model, inputTokens, outputTokens, costUsd }`. Refusals are `blocked` events with `ruleId` `llm:injection`, `llm:credential` or the budget id.

**Endpoints.** `POST /chat/completions`, `POST /responses` (OpenAI Responses API) and `POST /embeddings` go to providers with `api: openai`; `POST /messages` to `api: anthropic`; `GET /models` lists the literal (non-glob) routes the caller may use. Responses go through the same steps as chat: `instructions`, message items (`input_text`, earlier `output_text`), function and custom tool call arguments, tool call outputs and stored-prompt `variables` are masked; reasoning items, item references and the provider's own tool calls are passed back as they are; `input_file` and `input_audio` are refused (`415`). With `mode: tokenize`, tokens are put back in the answer, but a conversation continued with `previous_response_id` holds tokens from an earlier request that this request cannot put back — send the history in `input` if the answer must show real values.

Streaming works for chat, Messages and Responses. A plain stream is relayed event by event; for OpenAI the proxy adds `stream_options.include_usage` to count tokens and drops that extra chunk if the client did not ask for it. When the answer has to be rewritten (PII tokens to put back, or `maskResponses`), it is rewritten as it streams: text — message content, tool-call arguments, Anthropic text, JSON and thinking deltas — is held only until a safe cut (a space with no digit on either side, so a grouped number such as an IBAN or a card is never split; a private key block until its END line; a line with an `Adres:` label until it ends) and rewritten together with the last 300 characters already sent, so a label like `Pasaport No:` still applies to a value in the next event. Whatever is still held goes out just before the choice's finish chunk or the block's stop event. For the Responses API, `output_text`, function-call argument and reasoning-summary deltas are held and rewritten the same way; each `.done` event, item, part and the final `response.completed` carry the same rewritten text, so the SDK's assembled answer matches the deltas. Provider errors are passed through unchanged, so SDK retries and error types keep working.

### Embeddings

`POST /embeddings` masks every input text before it is embedded; the vectors come back unchanged. What to know before you index masked text:

- **Masking is deterministic here.** Built-in values get their fixed placeholder (`[TC-KİMLİK]`, `***@[EMAIL]`), `mode: tokenize` is not used (a token is per request, so the same document would embed differently every time), and org block patterns are numbered per text, not per request. The same text always produces the same vector, whatever batch it is sent in.
- **Documents that differ only in a masked value embed the same.** Two records that differ only by the person's name or ID number collapse to one vector, so similarity search cannot tell those people apart. Filter on your own ID field (metadata), not on vector similarity.
- **Index and query through the same path.** A vector made from masked text is only comparable with other vectors made from masked text: send both the documents you index and the queries you search with through the gateway, with the same `piiMasking` settings.
- **The length limit is per element.** Each element of `input` is checked against `llm.maxTextChars`; one element over it refuses the whole batch with `413`. Token-id input (`[[1, 2, 3]]`) cannot be masked and is refused with `415` — send text.
- Not applied to embeddings: prompt-injection scanning (a document about injection must still be indexable) and `llm.sensitive` routing (vectors from another model are not comparable with your index). Credential, topic, budget and access checks apply as usual.

### Failure behavior

The gateway fails closed: when it cannot check or mask a request, the provider is not called. The refusal carries a stable code in the error body (`error.code`, in the OpenAI and the Anthropic error shape) and in the `x-guardbee-error` header, and a `blocked` event goes to the audit log. Neither the response nor the audit log ever holds the text that could not be masked — a detector's own error message is replaced by its error class.

| Status | Code | When | Audit `ruleId` |
| --- | --- | --- | --- |
| `502` | `guardbee_masking_failed` | A detector or scan threw, a block pattern ran over its time budget, or the name model (`ner:`) did not answer. Covers every check before the call: injection, credentials, topics, sensitive routing, masking. | `pii:masking-failed`, `pii:pattern-timeout`, `pii:ner-failed` |
| `415` | `guardbee_unmaskable_content` | The request holds content the proxy cannot read: OpenAI `input_audio` or `file` parts, an Anthropic `document` with a PDF (base64, url or file) source, an unknown part or block type, or content that is not text or a list. The message names what was found. | `pii:unmaskable` |
| `413` | `guardbee_text_too_large` | A single text (message, part, tool result) is longer than `llm.maxTextChars` (default 2,000,000 characters). The limit is per text, not per request: split the text into several messages or parts. | `pii:text-too-large` |

What is not refused: images (`image_url`, Anthropic `image`) are forwarded unchanged and are not inspected; in an assistant turn, blocks the provider itself produced (`thinking`, `redacted_thinking`, `server_tool_use`, `*_tool_result`) are passed back as they are. `415` and `413` apply only when the request is masked — with `piiMasking.enabled: false`, on a route with `masking: off`, or for a request routed in-house by `llm.sensitive` without `mask: true`, nothing is masked and nothing is refused for being unmaskable.

An answer that cannot be masked (`maskResponses`, or a failure while putting tokens back) is withheld: the text is replaced by `[GuardBee: withheld, …]`, also mid-stream, and the event is logged with the same `ruleId`s.

**Passthrough per route.** `masking: off` on an `llm.routes` entry sends that route's prompts (and answers) unmasked. It has to be written out — there is no implicit passthrough — and every such request writes a `warn` event with `ruleId: pii:masking-off` naming the route; PII is still counted in `piiHits`. A topic rule with action `mask` still masks on that route.

In the MCP gateway a masking failure withholds the tool result: the client gets an MCP error (`InternalError`, `Result withheld: …`) with `data: { guardbee: "guardbee_masking_failed" }`, and no `tool_response` event is written.

---

## Coding-Agent Hooks

The proxy sees MCP traffic only. A coding agent's own tools — the shell, file reads, web fetch — never pass through it, so `cat .env` followed by `curl -d @.env …` is invisible to it. `guardbee-hook` applies the same policy to those tools through the agents' hook systems.

```bash
npm i -g @guardbee/mcp-security-proxy
guardbee-hook install --claude-code                 # ~/.claude/settings.json (PreToolUse + PostToolUse)
guardbee-hook install --cursor                      # ~/.cursor/hooks.json (shell, MCP, file reads)
guardbee-hook install --claude-code --project       # .claude/settings.json in this repo
guardbee-hook install --cursor --config ~/.guardbee/guardbee-proxy.yaml --fail-closed
guardbee-hook uninstall --claude-code               # removes only GuardBee's entries
```

Install keeps every other setting and hook, replaces its own entries when run again, and leaves a `.guardbee-backup` copy. `--dry-run` prints the result without writing. Run it from a global install: a path in the npx cache can be cleared.

**Labels.** Built-in tools get the same four labels as MCP tools, from what they do:

| Tool | Label |
|---|---|
| `Read`/`Grep`/`Glob` of `.env*`, `~/.ssh/`, `id_rsa`, `~/.aws/credentials`, `.kube/config`, `.npmrc`, `.netrc`, `*.pem`, `*.key`, `*.tfstate`, `credentials*.json`, … | `sensitive` |
| `Bash` reading those files, `printenv`, keychain and cloud-token commands | `sensitive` |
| `Bash` with `curl`, `wget`, `nc`, `scp`, `ssh`, `git push`, `npm publish`, `docker push`, `gh api`, `aws s3 cp`, … | `egress` (`curl`/`wget`/`git clone` also `untrusted`) |
| `Bash` with `rm -rf`, `git push --force`, `git reset --hard`, `DROP TABLE`, `terraform destroy`, `kubectl delete`, … | `destructive` |
| `WebFetch`, `WebSearch` | `untrusted` + `egress` (the URL or query can carry data out) |
| `mcp__server__tool` | the proxy's name heuristics |

**What is checked**, before the tool runs: a credential in a call that can send data out (`egress:credential`), your `rules` — with `upstream` set to `claude-code` or `cursor`, `tool` to the tool name (`Bash`, `Read`, `WebFetch`, `mcp__github__create_pull_request`), `args` to its input and `topic` to its topics — and the lethal-trifecta check: once the session has read untrusted content and sensitive data (a secret file, or PII in any output), an `egress` call is denied (`taint.mode: strict`), asked about (`approve`) or logged (`warn`). After it runs: PII in the output taints the session, instructions hidden in the output stop the agent (`decision: block` with the reason), and topic rules apply to the output.

```yaml
rules:
  - { id: ask-destructive, match: { upstream: claude-code, label: destructive }, action: approve }
  - { id: no-prod,         match: { tool: Bash, args: { command: "*--context prod*" } }, action: deny }
```

- The hook never answers "allow" for you: no objection leaves the agent's own permission prompts in place. `deny` becomes `permissionDecision: deny` (Cursor: `permission: deny`), `approve` becomes `ask`.
- `defaults.action` is not applied to agent tools — a `deny` default meant for MCP tools would otherwise block every shell command. Write rules for what to stop.
- Each hook call is a separate process (about 0.1–0.2 s). The session's taint is kept per agent session under `~/.local/state/guardbee/hooks` (`$XDG_STATE_HOME`) and expires after a day. The audit log goes to your configured file sink, or `~/.local/state/guardbee/hooks/audit.jsonl` — never to the agent's terminal — and to the dashboard when `audit.dashboard` is set.
- Config: `--config`, then `GUARDBEE_PROXY_CONFIG`, then `~/.guardbee/guardbee-proxy.yaml`, then built-in defaults. A file used only for hooks has a `hooks: {}` section and no upstreams.
- On an internal error the tool runs (fail open), unless the hook was installed with `--fail-closed`.
- Output of built-in tools is not rewritten: masking a file Claude reads would break its later `Edit` calls, which must match the file exactly.

---

## MCP Tools

The proxy does not register tools of its own. It forwards the target server's tools and applies the interceptor chain on every call.

---

## Interceptors

### Prompt Injection Detector

27 rules from [`@guardbee/guard-core`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/README.md), applied to tool arguments, tool results, resources and prompts:

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
| Phone (TR) | mobile / landline / 850 prefix; `(0532) …` too; a bare `5xx` number only after a word like `numaram`, `tel`, `cep` | `0532 123 45 67` | `+90-***-***-**[TELEFON]` |
| Tax number (VKN) | check digit, needs a `VKN` / `Vergi No` label | `VKN: 1234567890` | `VKN: [VKN]` |
| Provider keys | 22 key and token formats from secret-scanner (AWS, GitHub, Stripe, OpenAI, Anthropic, Slack, …) | `ghp_…`, `AKIA…` | `[API-KEY]` |
| Other API keys | `sk_`/`api_`/`token_`… prefix, letters and digits | `api_k3y9x8…` | `[API-KEY]` |
| Private key | whole BEGIN…END block | `-----BEGIN … PRIVATE KEY-----` | `[PRIVATE-KEY]` |
| Connection string | user:password in the URL (localhost excluded) | `postgres://app:pw@db/prod` | `[CONNECTION-STRING]` |
| JWT | — | `eyJhbGc...` | `[JWT-TOKEN]` |
| Passport | needs a `Pasaport` / `Passport` label | `Pasaport No: U12345678` | `Pasaport No: [PASAPORT]` |
| SGK / SSK / Bağ-Kur no | needs the label | `SGK sicil no: 1234567890` | `SGK sicil no: [SGK-NO]` |
| MERSİS no | needs the label; 16 digits | `MERSİS No: 0123 4567 8901 2345` | `MERSİS No: [MERSİS]` |
| Date of birth | needs `Doğum tarihi` / `DOB` / `Date of birth`, or `doğumlu` right after; digits or a month name | `Doğum tarihi: 12.05.1990`, `3 Mart 1979 doğumlu` | `Doğum tarihi: [DOĞUM-TARİHİ]` |
| Postal address | needs `Adres:` / `Address:` (a number or street word; not IP/e-mail/web/wallet addresses), or no label in the `Mah. … Cad./Sok. … No:` form | `Adres: Moda Cad. No 5`, `Gazi Mah. Akasya Cad. No:5 D:3` | `Adres: [ADRES]` |
| KEP address | `@….kep.tr` | `acme@hs01.kep.tr` | `***@[KEP]` |
| Person name *(needs `ner:`)* | a local Turkish NER model ([`@guardbee/ner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/ner)) | `Ayşe Yılmaz aradı` | `[KİŞİ] aradı` |
| IP address *(opt-in)* | valid IPv4 octets; IPv6 with `::` or 8 groups | `10.0.3.17` | `[IP]` |
| MAC address *(opt-in)* | 6 hex pairs, one separator | `aa:bb:cc:dd:ee:ff` | `[MAC]` |
| Vehicle plate, TR *(opt-in)* | province 01–81, letter/digit combination, not units (`16 GB 2400`) | `34 ABC 123` | `[PLAKA]` |

IP and MAC addresses and plates are everywhere in infrastructure output, so they are off unless you list them: `interceptors.piiMasking.include: [ip_address, mac_address, plate_tr]`. Every category is counted in `piiHits` and the dashboard's KVKK report.

**Choosing what to mask.** `piiMasking.preset` picks the detectors that mask, and `enable` / `disable` add or drop detectors by name (the names in `piiHits`, e.g. `tc_kimlik`, `email`, `github_pat`). `upstreams.<name>` replaces the selection for one upstream or LLM provider. Detection does not narrow: every default detector still counts in `piiHits` and taints the session, only masking follows the selection. Opt-in detectors are in no preset; list them in `enable` (or `include`).

| Preset | Masks |
| --- | --- |
| `ALL` (default) | every detector above except the opt-in ones, plus credentials |
| `KVKK` | personal data only, no credentials |
| `KVKK_SENSITIVE` | `KVKK` plus the nine KVKK Art. 6 special categories (below) |
| `IDENTITY` | person name (with `ner:`), postal address, date of birth |
| `IDENTIFIERS` | TC kimlik, VKN, MERSİS, SGK, passport, IBAN, card, phone, KEP, e-mail |
| `SECRETS` | API keys, tokens, private keys, connection strings, JWTs |

```yaml
interceptors:
  piiMasking:
    enabled: true
    preset: KVKK
    disable: [address]
    upstreams:
      ops: { preset: SECRETS, enable: [ip_address] }   # an infrastructure server
```

An unknown preset, detector or upstream name fails config validation.

**Your own patterns.** `piiMasking.blockPatterns` masks what no detector knows (a case number, a client code): a regex, or `{ pattern, category }`; the category becomes a numbered placeholder (`CLIENT_NO` → `<CLIENT_NO_1>`, the same value gets the same number) and the `piiHits` key. A built-in detection wins an overlap, and block patterns apply whatever the preset. `piiMasking.allowPatterns` leaves a detected value unmasked when its whole text matches (your public support address); every time one does, a `warn` event with `ruleId: pii:allow` goes to the audit log, since it lowers protection.

```yaml
interceptors:
  piiMasking:
    enabled: true
    blockPatterns:
      - { pattern: "CL-\\d{6}", category: CLIENT_NO }
      - "DOSYA/\\d{4}"                       # category CUSTOM
    allowPatterns: ["destek@acme\\.com\\.tr"]
```

Each pattern gets a time budget (100 ms per masking call), so a catastrophic regex cannot hang the proxy, and the two kinds fail in opposite directions on purpose: a block pattern over budget withholds the result (`pii:pattern-timeout`; the LLM gateway answers 502), an allow pattern over budget is skipped and the value stays masked (`pii:allow-skipped`). At most 25 patterns, 200 characters each; an invalid regex, or a category named like a built-in detector (`EMAIL`, `IBAN`, `SECRET`, …), fails config validation. An LLM gateway request can add its own block patterns in a `guardbee` body field (`{ "guardbee": { "blockPatterns": [...] } }`, removed before the provider sees the body); they are added to the configured ones, and a request with `allowPatterns` is refused with 400: a request can only add masking.

A number that fails its checksum (an order number, a tracking code) is left as is.

**Person names.** No regex finds a name, so `person_name` comes from a model: [`@guardbee/ner`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/ner), a Turkish BERT NER model that runs offline (186 MB, about 8 ms per text on a laptop CPU). It is off until the config has a top-level `ner:` section. That section is deployment, not policy: a dashboard policy cannot set or move it.

```yaml
ner:
  url: http://127.0.0.1:8765        # guardbee-ner serve (sidecar)
  tokenEnv: GUARDBEE_NER_TOKEN      # its bearer token, from the environment
  timeoutMs: 5000                   # default
# or in this process (install @guardbee/ner next to the proxy):
# ner:
#   modelDir: /opt/guardbee/ner     # default: guardbee-ner download's cache
```

Run the sidecar with `npx @guardbee/ner download` then `npx @guardbee/ner serve`; it listens on loopback. A sidecar on another host must be `https://`, since the texts would otherwise cross the network in the clear. The model checks its files against pinned SHA-256 hashes before it loads.

Before masking, every string in the value is sent to the model once, then masked in the same pass as the regex detectors, so `person_name` follows `preset` / `enable` / `disable`, `mode: tokenize` (`<pii:person_name:…>`) and allow patterns like any detector. Names are masked in tool results, `structuredContent`, resources, prompt templates, sampling answers, and LLM gateway requests (embeddings too), and they count for `llm.sensitive` routing. With `llm.maskResponses`, names in the model's answers are masked too. In a stream, text is not cut next to a capitalised word, so a name reaches the model whole. If the model fails on an answer, the rest of that answer is withheld (`[GuardBee: withheld, name detection failed]`). Coding-agent hooks count names in tool output for the session's taint; if the model fails there, the output is counted as personal data. A hook process starts for every call, so give hooks a sidecar (`ner.url`) rather than `modelDir`. Names are not looked for when masking is off.

A model span that lies wholly inside a special-category term (`Huntington` in `Huntington geni`) is left to that category when `KVKK_SENSITIVE` runs.

When `ner:` is set and the model cannot answer (sidecar down, timed out, an error), nothing goes out: the tool result is withheld and an LLM request is refused with `502 guardbee_masking_failed`, `ruleId: pii:ner-failed`. Masking never falls back to regex only, because the text may hold a name that only the model would find.

The model misses some names and flags some words. A capitalised word at the start of a sentence that is also a name (`Barış`, `Umut`) can go either way, and all-lowercase chat (`elifle konuştum`) is often missed. Measured numbers are in [pii-bench](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/pii-bench).

**KVKK Art. 6 special categories.** `preset: KVKK_SENSITIVE` (or `enable` by name) also masks health, religion and belief, ethnic origin, political opinion, union membership, criminal record, sex life, biometric and genetic data: `health` → `[SAĞLIK]`, `religion_belief` → `[DİN-İNANÇ]`, `ethnic_origin` → `[ETNİK-KÖKEN]`, `political_opinion` → `[SİYASİ-GÖRÜŞ]`, `union_membership` → `[SENDİKA]`, `criminal_record` → `[SABIKA]`, `sex_life` → `[CİNSEL-HAYAT]`, `biometric` → `[BİYOMETRİK]`, `genetic` → `[GENETİK]`. They are found with a Turkish and English term list per category and a context rule. A term is masked only when the same text is about a person: a name the model found, a personal identifier, or a word that points at someone (`hastanın`, `çalışan`, `babam`, a first-person verb). `Diyabet hastaları için rehber` is left as it is; `Çalışan migren nedeniyle raporlu` becomes `Çalışan [SAĞLIK] nedeniyle raporlu`. The span grows over the phrase around the term, so `metal işçileri sendikası üyesi` is masked whole.

These detectors are opt-in, because a term list cannot tell a medical knowledge base from a patient file. The bias is conservative: once a text is about someone, every listed term in it is masked. They find words, not meaning, so a term that is not on the list is missed. Use them with `ner:`, since without names many texts are about a person only through their name. In [pii-bench](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/pii-bench#kvkk-art-6-term-lists) the hand-written challenge set gives F1 86–100 per category with the name model and 40–89 without, with no false alarms on its clean lines. They add under 0.15 ms per text.

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

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
