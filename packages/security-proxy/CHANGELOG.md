# @guardbee/mcp-security-proxy

## 1.5.0

### Minor Changes

- [#21](https://github.com/GuardBee/guardbee-mcp/pull/21) [`9015a52`](https://github.com/GuardBee/guardbee-mcp/commit/9015a52368228a357519a977d3ef7809b082633a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Audit events for tool responses and resource reads that contained personal data now carry `piiHits`: a count per category (`tc_kimlik`, `vkn`, `iban`, `credit_card`, `email`, `phone_tr`, and `secret` for credentials). Counts only, never values; counted even with masking off. The GuardBee dashboard's KVKK report is built from them.

## 1.4.0

### Minor Changes

- [#19](https://github.com/GuardBee/guardbee-mcp/pull/19) [`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Central policy from the GuardBee dashboard.
  
  guard-core: `gatewayPolicySchema`, `policyShape` and `validatePolicy` describe the gateway policy document (labels, rules, taint, approval, defaults, interceptors). security-proxy builds its YAML schema from them, and the dashboard validates an edit with the same schema before saving it. guard-core now depends on zod.
  
  security-proxy: `policy: { source: dashboard, refreshSeconds }` (needs `audit.dashboard`) takes the policy from the workspace policy in the dashboard. Upstreams, listen and audit stay local. The proxy fetches it at start and re-checks it with an ETag; an update applies to the next call in every session. With no dashboard policy, an unreachable dashboard or an invalid document it keeps the local or last good policy. Approval settings are now read per request, so a policy update changes them mid-session too.

### Patch Changes

- Updated dependencies [[`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35)]:
  - @guardbee/guard-core@0.3.0

## 1.3.0

### Minor Changes

- [#17](https://github.com/GuardBee/guardbee-mcp/pull/17) [`dac242d`](https://github.com/GuardBee/guardbee-mcp/commit/dac242dbcf7258039ca4bd7c6d44059e420b6a36) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Approvals in the GuardBee dashboard.
  
  `approval.channels: [elicitation, dashboard]` (with `audit.dashboard` configured) sends an approval request to the dashboard when the client cannot show a prompt. The arguments go PII-masked, the dashboard notifies workspace owners and admins, and the proxy polls until the request is approved, denied or expired, or `timeoutSeconds` passes. Channels are tried in order; a channel that cannot ask (no elicitation support, dashboard unreachable) falls through to the next one. Requires app.guardbee.ai with the gateway approvals endpoint.

## 1.2.0

### Minor Changes

- [#15](https://github.com/GuardBee/guardbee-mcp/pull/15) [`7891f8d`](https://github.com/GuardBee/guardbee-mcp/commit/7891f8d095937d6cb6329b948fbc957772e788b7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Remote mode: the gateway over Streamable HTTP.
  
  - `listen: { transport: http, host, port, path, apiKeys, maxSessions }` serves the proxy over Streamable HTTP. Each MCP session gets its own taint state, PII tokens and tool pins; all sessions share the upstream connections. Listening beyond loopback without `apiKeys` is a config error; keys are checked in constant time. `GET /healthz` reports the session count.
  - Upstreams can be remote Streamable HTTP servers: `url` plus optional `headers` (with `${VAR}` references).
  - `audit.dashboard` sends audit events in batches to the GuardBee dashboard with a workspace API key read from `apiKeyEnv`. Events wait in memory while the dashboard is unreachable; tool calls never wait for it. Events now carry `sessionId` in HTTP mode.
  - `init` also moves Streamable HTTP servers behind the proxy; SSE servers stay and are reported.
  - A shared upstream now fans its `tools/list_changed` notification out to every session; before, only the most recent listener received it.
  - Dockerfile for running the proxy as a service.

## 1.1.1

### Patch Changes

- Docs: add a Simplified Chinese README (`ZH.md`) and link it from the English and Turkish ones. Correct stale counts (secret-scanner: 38 patterns and 39 tests; prompt-injection-scanner: 45 tests) and add a Turkish README for guard-core. No code changes.
- Updated dependencies [`243991e`]:
  - @guardbee/guard-core@0.2.1

## 1.1.0

### Minor Changes

- Shared detectors: one injection rule set, provider secrets, Turkish identifiers.
  
  guard-core
  - `INJECTION_RULES`: the prompt-injection-scanner rules and the security-proxy 0.x phrases in one list (27 rules). New: Turkish instruction override and prompt extraction, `DAN mode`, "bypass safety/guardrails", `<system>` tags, Unicode tag-character smuggling (flag emoji excluded), bidi control characters. `findInjections` also decodes base64 runs that turn into readable text and checks them.
  - Each rule is precise or `broad`. `scanForPromptInjection` blocks only on a precise high/critical rule and warns on the rest.
  - `SECRET_RULES`: the secret-scanner provider formats, moved here.
  - PII masking now covers private key blocks (whole BEGIN…END), connection strings with passwords, 22 provider key and token formats, and VKN (check digit plus a `VKN` / `Vergi No` label). Phone numbers must have a Turkish mobile, landline or 850 code and a +90 / 0 prefix or space/dash grouping, and must not sit inside a URL or id; the generic API-key rule needs a separator and both letters and digits (`tokenization1234567890ab` is no longer masked).
  - New validators: `isValidVkn`, `isValidTrPhone`.
  
  security-proxy
  - Uses the shared rules. A generic phrase alone ("act as", "you are now", "developer mode", "jailbreak", "override policy") now warns instead of blocking; in 1.0 a tool result saying "act as a reverse proxy" was blocked.
  - Masks provider keys, private keys, connection strings and VKN. A 10-digit number that cannot be a Turkish phone number is no longer masked as one, and no longer marks the session as holding sensitive data.
  
  prompt-injection-scanner: 17 rules instead of 10 (the precise ones from guard-core). The HTML-comment and CSS-hidden rules no longer fire on `<!-- prettier-ignore -->`, on a comment that merely mentions "instructions", or on `background-color: white`: they now need instruction-like language ("ignore all/the/previous …", "system prompt", "AI:"). Measured on 1,610 package READMEs, blocking findings went from 20 files to 0.
  
  secret-scanner: rules now come from guard-core; no change in what it reports.

### Patch Changes

- Updated dependencies [`15fb399`]:
  - @guardbee/guard-core@0.2.0

## 1.0.0

### Major Changes

- security-proxy 1.0: gateway mode.
  
  - `guardbee-proxy.yaml` puts several MCP servers behind one proxy. Tools and prompts are exposed as `<upstream>__<tool>`; one failing server no longer hides the others' tools.
  - Policy rules (`allow` / `deny` / `mask` / `warn`) match on tool glob, upstream, label and session taint; the first match wins.
  - Toxic-flow (lethal trifecta) tracking across servers: once a session has read untrusted content and sensitive data, an egress call is blocked (`taint.mode: strict`, the YAML default) or logged (`warn`).
  - `resources/read` is now scanned for injection, PII-masked, and counted as untrusted content.
  - The audit log is hash-chained (`guardbee-proxy verify-audit <file>`). With the YAML config it stores a SHA-256 of the arguments instead of the arguments, and no results, unless `audit.includePayloads: true`.
  - New `guardbee-proxy validate` command.
  
  The single-server `guardbee-proxy -- <command>` form and `guardbee-proxy.json` keep their 0.x behavior: unprefixed tool names, payloads logged, toxic flows only warned.
  
  toxic-flow-auditor: tool names in snake_case are now classified word by word (`read_vault_secret` is sensitive, `drop_table` destructive), and pull requests count as exfiltration. Catalogs may report more findings than before.

### Minor Changes

- Move shared detectors into the new `@guardbee/guard-core` library.
  
  security-proxy now validates PII matches before masking them: a TC Kimlik No must pass the official checksum, an IBAN must pass mod-97, and a card number must pass Luhn. Order numbers and other 11- or 16-digit values are no longer masked by mistake.
  
  toxic-flow-auditor and prompt-leak-scanner now import tool classification and checksum validators from guard-core. prompt-leak-scanner behaves as before; for toxic-flow-auditor see the snake_case classification fix.

- Gateway: approvals, tokenized PII, `init`.
  
  - `approve` action and `taint.mode: approve`: the person answers a yes/no form through MCP elicitation; decline, cancel, a timeout (`approval.timeoutSeconds`, default 120) or a client without elicitation all block the call.
  - `interceptors.piiMasking.mode: tokenize`: the model sees session tokens such as `<pii:tc_kimlik:7f3a9b21>`, and the proxy puts the real value back when the token is passed to another tool — never to an `egress` tool unless `detokenizeForEgress: true`.
  - Rules can match on `args` (dotted path → value, strings are globs), and `mask.fields` blanks named JSON keys in text and `structuredContent`.
  - PII in `structuredContent` is now masked; before, only text content was.
  - `prompts/get` results get the injection scan and PII masking.
  - `definitionDrift.recheck: on-change` re-lists a server's tools only after it sends `tools/list_changed`; the proxy relays that notification to the agent.
  - `guardbee-proxy init --client claude-desktop|cursor|claude-code` (or `--file`) moves stdio servers into `guardbee-proxy.yaml`, backs up the client config and points it at the proxy.

### Patch Changes

- `guardbee-proxy` now starts with a `#!/usr/bin/env node` line. Without it, `npx @guardbee/mcp-security-proxy` (and the installed bin) ran the file as a shell script and failed to start (seen on 0.3.1).

## 0.3.0

### Minor Changes

- [#6](https://github.com/GuardBee/guardbee-mcp/pull/6) [`7f0e01f`](https://github.com/GuardBee/guardbee-mcp/commit/7f0e01f9b15e033928c395ccffbb0118842a604c) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add an MCP client-config auditor, live tool-catalog poisoning checks, cross-server tool shadowing, and proxy guards for tool-result injection and mid-session definition drift. Findings that these checks emit carry OWASP MCP Top 10 tags.

### Patch Changes

- [#4](https://github.com/GuardBee/guardbee-mcp/pull/4) [`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Fix MCP contracts that disagreed with the implementation: dependency-auditor no longer claims Cargo manifest scanning and parses npm lockfile names, PEP 621 pyproject files, and CVSS vectors; rug-pull `--no-auto-baseline` does not report a baseline it did not save; the security proxy honors warn mode and `PROXY_*` settings; scanners reject a non-positive `maxFiles` and document exclude entries as path substrings. `@guardbee/mcp-telemetry` now has a CommonJS export so the CommonJS `db-gateway` and `security-proxy` binaries can load it.
- Updated dependencies [[`72a8129`](https://github.com/GuardBee/guardbee-mcp/commit/72a81293820c7d41047bca38ccc25ed6fa676297)]:
  - @guardbee/mcp-telemetry@0.1.3

## 0.2.2

### Patch Changes

- Fix each package's `repository` field to point at the actual monorepo (`github.com/GuardBee/guardbee-mcp`) with a `directory` pointing at its own subfolder. 9 packages still pointed at their old, now-archived standalone repos from before the 2026-09-11 monorepo migration (never updated); the 4 packages added since then pointed at the right repo but were missing `directory`. This mattered in practice, not just cosmetically: npm rewrites relative README links (e.g. the `TR.md` language-switcher link) using `repository.url` + `repository.directory`, so every package's Turkish-README link on npmjs.com was resolving to either a 404 (wrong/archived repo) or the wrong path (repo root instead of the package's subfolder). Also fixes `db-gateway`'s and `security-proxy`'s stale `bugs.url` and `db-gateway`'s stale `homepage`, and the same stale repository URL in `db-gateway/manifest.json`.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.2

## 0.2.1

### Patch Changes

- Make English the primary `README.md` (what npm and GitHub display by default) for every package, matching the change already made for `db-gateway`. The previous Turkish content moves to `TR.md`, linked via a language switcher at the top of both files. Docs-only change, no code/behavior changes.
- Updated dependencies []:
  - @guardbee/mcp-telemetry@0.1.1

## 0.2.0

### Minor Changes

- [`8115d23`](https://github.com/GuardBee/guardbee-mcp/commit/8115d2343190febb3fa7101f5edec142c0b80967) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add usage telemetry via the new `@guardbee/mcp-telemetry` shared package — **on by default**, disable with `GUARDBEE_TELEMETRY=0`. Every tool call reports the tool name, a shape-preserving-redacted version of its parameters, success/failure, and duration to `app.guardbee.ai`.
  
  Redaction (`redactParams`, see `@guardbee/mcp-telemetry`'s README) replaces any string longer than 40 characters, and the value of any `content`/`text`/`data`/`filter`/`password`/`email`/`apiKey`/`token`/`secret` key regardless of length, with a `"[redacted: ...]"` placeholder — full file/scan content and real row data are never sent, only short structural parameters like table names or limits. A one-time notice is printed to stderr on first use explaining this and how to opt out. This is a behavior change (these packages now make an outbound network call by default) — previously most of them advertised running entirely offline.

### Patch Changes

- [`64eb8b0`](https://github.com/GuardBee/guardbee-mcp/commit/64eb8b0fa9425ab3b03fa9621737bda9a238519b) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Add Smithery.ai integration files (`smithery.yaml`, `manifest.json`, `.well-known/mcp/server-card.json`), matching the pattern already used by `@guardbee/mcp-db-gateway`, so these servers are one-click installable from Smithery and discoverable via their MCP server card. No functional/runtime code changes — these files are read from the GitHub repo by Smithery, not from the published npm tarball (`package.json` `files` is unchanged).
