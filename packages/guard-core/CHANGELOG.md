# @guardbee/guard-core

## 0.8.0

### Minor Changes

- [#49](https://github.com/GuardBee/guardbee-mcp/pull/49) [`34ead6f`](https://github.com/GuardBee/guardbee-mcp/commit/34ead6fb45d6b093c441b28c83d73107ff20d0a3) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Credentials leaving (`interceptors.egressSecrets`, on by default): before an `egress` tool runs, the arguments it would actually receive are checked for provider keys, private keys and connection strings with a password (the fixed-format rules PII masking uses). `block` refuses the call, `warn` logs it, and the audit event has the credential masked either way. `allowTools` exempts tools by glob. guard-core's policy schema gains `interceptors.egressSecrets`.

## 0.7.0

### Minor Changes

- [#47](https://github.com/GuardBee/guardbee-mcp/pull/47) [`aa299d3`](https://github.com/GuardBee/guardbee-mcp/commit/aa299d3d3343bfbf48bc36b78036d7d7cb1565ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool poisoning at `tools/list` (`interceptors.toolPoisoning`, on by default): the gateway scans each tool definition before the agent sees it and, in `block` mode, hides a tool with a critical or high finding and refuses its calls; medium findings warn. The catalog rules move from tool-poisoning-scanner into guard-core (`scanToolCatalog`, `DESCRIPTION_INJECTION_PATTERNS`, …), which tool-poisoning-scanner re-exports unchanged. `mixed_script_in_description` now flags only a word that mixes Latin with Cyrillic or Greek letters, not a description written in another script next to Latin words.

## 0.6.0

### Minor Changes

- [#45](https://github.com/GuardBee/guardbee-mcp/pull/45) [`b8dee60`](https://github.com/GuardBee/guardbee-mcp/commit/b8dee60a6092f16ba1442cafafa60fa842cffd42) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Tool exposure (`tools`): `expose` (allowlist of globs) and `hide` take tools out of `tools/list`, and calls to a hidden tool are refused and count toward `anomaly.repeatedBlocks`. `descriptions` replaces a tool's description with one you wrote. guard-core's policy schema gains `tools`, so the dashboard can set it too. Also: `interceptors.anomaly` now follows dashboard policy updates in running sessions instead of only at session start.

## 0.5.0

### Minor Changes

- [#40](https://github.com/GuardBee/guardbee-mcp/pull/40) [`b1de97f`](https://github.com/GuardBee/guardbee-mcp/commit/b1de97f5cbeaf1951798970a56917b8378b45848) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Anomaly checks for the gateway (`interceptors.anomaly`): per-session sliding-window limits on call bursts, sweeps of distinct sensitive reads, bulk destructive calls, and repeated blocked or declined calls. `warn` logs the first trip of each check; `block` refuses calls over the limit, and after repeated blocks locks the session. Events reuse the `warn`/`blocked` types with `ruleId: anomaly:<check>`, so the dashboard ingest accepts them unchanged. guard-core's policy schema gains `interceptors.anomaly`. Off unless configured.

## 0.4.0

### Minor Changes

- [#24](https://github.com/GuardBee/guardbee-mcp/pull/24) [`75f4bad`](https://github.com/GuardBee/guardbee-mcp/commit/75f4baddd164e252be4f8004e2ec8e0054cbd218) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Data-based taint: `taint.basis: data` treats an egress call as a toxic flow only when its arguments carry sensitive data the session saw (hashed fingerprints of PII, credentials, id-like tokens and 12+ word passages; PII tokens count as their values), not merely because the session touched untrusted and sensitive content. The block message names the tool the data came from. The default `capability` basis keeps today's behaviour and adds the same evidence to its reason when found. guard-core's policy schema gains `taint.basis`.

## 0.3.0

### Minor Changes

- [#19](https://github.com/GuardBee/guardbee-mcp/pull/19) [`0b02da8`](https://github.com/GuardBee/guardbee-mcp/commit/0b02da8ed7338c4f7dd1939d4e5be4ecd5f63a35) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Central policy from the GuardBee dashboard.
  
  guard-core: `gatewayPolicySchema`, `policyShape` and `validatePolicy` describe the gateway policy document (labels, rules, taint, approval, defaults, interceptors). security-proxy builds its YAML schema from them, and the dashboard validates an edit with the same schema before saving it. guard-core now depends on zod.
  
  security-proxy: `policy: { source: dashboard, refreshSeconds }` (needs `audit.dashboard`) takes the policy from the workspace policy in the dashboard. Upstreams, listen and audit stay local. The proxy fetches it at start and re-checks it with an ETag; an update applies to the next call in every session. With no dashboard policy, an unreachable dashboard or an invalid document it keeps the local or last good policy. Approval settings are now read per request, so a policy update changes them mid-session too.

## 0.2.1

### Patch Changes

- Docs: add a Simplified Chinese README (`ZH.md`) and link it from the English and Turkish ones. Correct stale counts (secret-scanner: 38 patterns and 39 tests; prompt-injection-scanner: 45 tests) and add a Turkish README for guard-core. No code changes.

## 0.2.0

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
