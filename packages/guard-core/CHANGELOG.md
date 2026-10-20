# @guardbee/guard-core

## 0.21.0

### Minor Changes

- [#162](https://github.com/GuardBee/guardbee-mcp/pull/162) [`c1a16b9`](https://github.com/GuardBee/guardbee-mcp/commit/c1a16b9c9f588c4d3735fb45a1339b33119a8de0) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Find more Turkish phone numbers, dates of birth and addresses. These were the gaps pii-bench found.
  
  - `phone_tr`: an area code in parentheses (`(0532) 123 45 67`, `0 (212) …`) is now found. A bare 10-digit mobile number (`5321234567`) counts only shortly after a word that says it is a phone number (`numaram`, `tel`, `cep`, `iletişim`, `whatsapp`), so `build 5321234567` is still left alone.
  - `birth_date`: new label forms (`doğum tarihim`, upper-case `DOĞUM TARİHİ`, `born on`), month names in Turkish and English (`3 Mart 1979`), and a date right before `doğumlu` with no label (`12 Şubat 1985 doğumlu`).
  - `address`: a street address with no label in the standard form `<…> Mah. <…> Cad./Sok./Blv. No:<n>`, with optional flat and district/city. Upper-case `ADRESİ:` labels now count too.
  - On tr-pii-v1, identifier F1 goes from 84.4 to 97.1, with no new false alarms on the clean set. Those fixes were tuned on that set, so expect less on real text.

## 0.20.0

### Minor Changes

- [#160](https://github.com/GuardBee/guardbee-mcp/pull/160) [`e3355b2`](https://github.com/GuardBee/guardbee-mcp/commit/e3355b23654afcb2eb144da18e54fbfdb2817b16) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - KVKK Art. 6 special categories and the `KVKK_SENSITIVE` preset ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).
  
  - guard-core: nine new detectors. `health`, `religion_belief`, `ethnic_origin`, `political_opinion`, `union_membership`, `criminal_record`, `sex_life`, `biometric` and `genetic` mask as `[SAĞLIK]`, `[DİN-İNANÇ]`, `[ETNİK-KÖKEN]`, `[SİYASİ-GÖRÜŞ]`, `[SENDİKA]`, `[SABIKA]`, `[CİNSEL-HAYAT]`, `[BİYOMETRİK]` and `[GENETİK]`.
  - How they work: a Turkish and English term list per category, plus a context rule. A term is masked only when the text is about a person: a name from the NER lookup, a personal identifier, or a word that points at someone. The mask grows over the phrase around the term.
  - They are opt-in. They are in no preset except the new `KVKK_SENSITIVE` (`KVKK` plus these), and can also be turned on by name. New exports: `SPECIAL_CATEGORIES` and `SPECIAL_CATEGORY_REPLACEMENT`.
  - security-proxy: `preset: KVKK_SENSITIVE` and the category names are accepted in config. Findings count as personal data in `piiHits`, taint and hooks.
  - document-scanner: the same categories count as personal data.
  - pii-bench has a new hand-written `tr-special-challenge` set. With the name model, per-category F1 there is 86–100, and its clean lines get no false alarms.

## 0.19.0

### Minor Changes

- [#156](https://github.com/GuardBee/guardbee-mcp/pull/156) [`5e6d872`](https://github.com/GuardBee/guardbee-mcp/commit/5e6d872cd6b9014da63743bc2198a0eb159c3b49) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Optional NER backend for Turkish person names ([#126](https://github.com/GuardBee/guardbee-mcp/issues/126)).
  
  - New package `@guardbee/ner`: a local BERTurk NER model (akdeniz27/bert-base-turkish-cased-ner, int8, MIT) on ONNX Runtime, offline. `guardbee-ner download` fetches it at a pinned revision and checks SHA-256 hashes; `NerModel.load()` refuses missing or altered files. Runs in-process or as a sidecar (`guardbee-ner serve`, loopback by default, optional bearer token, texts never logged). Picked out of five Turkish NER models on the pii-bench numbers: person-name F1 99.5 on tr-pii-v1, 97.1 on the hand-written hard-names set, p50 8 ms per document.
  - guard-core: `maskPiiInText` / `maskPiiInValue` take a fifth argument, a `SpanLookup`, and mask what a model found in each string in the same pass (placeholder `[KİŞİ]`, or the replacer's value). A lookup must throw for a text it has no result for, so an unscanned text is never passed as clean. A model span inside an e-mail address or URL is left to the regex detector, which masks the whole value. New detector name `person_name` (in `PII_DETECTORS` and the `ALL`, `KVKK` and `IDENTITY` presets; it finds nothing without a lookup), `MODEL_PII`, `ModelSpan`, `ModelDetector`.

## 0.18.0

### Minor Changes

- [#148](https://github.com/GuardBee/guardbee-mcp/pull/148) [`d4b24f4`](https://github.com/GuardBee/guardbee-mcp/commit/d4b24f4234e565f4660b3a356140516119ad4548) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Org-level PII patterns. `blockPatterns` mask an organization's own identifiers as numbered placeholders (`<CLIENT_NO_1>`); `allowPatterns` leave a detected value unmasked and are flagged in the audit log. Each pattern runs with a time budget: a block pattern over budget fails closed (result withheld, LLM gateway 502), an allow pattern over budget is skipped. Max 25 patterns of 200 characters; invalid regexes and categories named like built-in detectors fail validation. An LLM gateway request can add block patterns (`guardbee.blockPatterns`) but never allow patterns.

## 0.17.0

### Minor Changes

- [#146](https://github.com/GuardBee/guardbee-mcp/pull/146) [`0e96d18`](https://github.com/GuardBee/guardbee-mcp/commit/0e96d18c6d96a505a5cf5774af2a29d323d066e1) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - PII category presets. guard-core exports `PII_PRESETS` (`ALL`, `KVKK`, `IDENTITY`, `IDENTIFIERS`, `SECRETS`), `piiScope({ preset, enable, disable })` and a config schema that rejects unknown preset or detector names. security-proxy takes `interceptors.piiMasking.preset` / `enable` / `disable`, with `piiMasking.upstreams.<name>` per upstream or LLM provider; detection stays complete (taint, `piiHits`), only masking narrows. db-gateway gets `piiScan`: value-based masking of PII inside text columns no field rule covers, off by default, also set with `GATEWAY_PII_SCAN`.

## 0.16.0

### Minor Changes

- [#144](https://github.com/GuardBee/guardbee-mcp/pull/144) [`a489a7e`](https://github.com/GuardBee/guardbee-mcp/commit/a489a7e06e4dc8dfd208572efbb46e81e0bc3c69) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - PII and secret masking now sees through Unicode look-alikes: fullwidth digits, mathematical bold letters and zero-width characters inside a TC kimlik, IBAN, e-mail or API key no longer bypass the detectors. Detection runs on an NFKC copy with invisible characters removed and maps back to the original text, so unmasked text keeps its original spelling and every spelling of a value gets the same token.

## 0.15.0

### Minor Changes

- [#123](https://github.com/GuardBee/guardbee-mcp/pull/123) [`945ed3c`](https://github.com/GuardBee/guardbee-mcp/commit/945ed3c817660b0cf479c2ce1777c1a4cc4ea5c1) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - `interceptors.documents` (off by default): images, embedded PDFs and resource blobs in tool results and resource reads are scanned for PII and credentials with the new `@guardbee/mcp-document-scanner` (PDF text layer, optional OCR) and withheld (`block`) or logged (`warn`). The shared policy schema accepts the new interceptor.

- [#136](https://github.com/GuardBee/guardbee-mcp/pull/136) [`b3ea8b8`](https://github.com/GuardBee/guardbee-mcp/commit/b3ea8b8cac409b80d9d8fdab5527871509c45232) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Security reports: `guardbee-proxy report` builds a periodic report from the audit log (Markdown, HTML or JSON; English or Turkish) with findings mapped to OWASP Top 10 for LLM Applications (2025) and MITRE ATLAS, tied to the audit hash chain and optionally Ed25519-signed; `guardbee-proxy verify-report` checks it. The mapping (`classifyEvent`, `THREAT_CATEGORIES`) lives in guard-core and is shown by threat-rules' new `framework_map` tool.

## 0.14.0

### Minor Changes

- [#118](https://github.com/GuardBee/guardbee-mcp/pull/118) [`08cc29e`](https://github.com/GuardBee/guardbee-mcp/commit/08cc29e4ca69af9aaf2bcbbde9f31824c9ada5c7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - More PII detectors: passport, SGK/SSK/Bağ-Kur number, MERSİS number, date of birth and postal address (all label-gated), KEP address, and opt-in IP address, MAC address and Turkish vehicle plate (`piiMasking.include`). guard-core exports `PERSONAL_DATA_CATEGORIES` and `OPT_IN_PII`; every new category is counted in `piiHits`.

## 0.13.0

### Minor Changes

- [#116](https://github.com/GuardBee/guardbee-mcp/pull/116) [`13c4c8f`](https://github.com/GuardBee/guardbee-mcp/commit/13c4c8f7afb29c7c373f83b1f64ae518edc08a46) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Topic-based policy rules: a `topics` list (terms in Turkish or English, case- and Turkish-letter-insensitive, suffix-tolerant) and a `match.topic` rule field. The proxy checks topic rules on tool arguments and again on tool results, resources and prompts (`deny` withholds, `mask` forces PII masking, `warn` logs, `approve` asks), and on LLM gateway prompts with `tool: llm:<model>`. guard-core exports `detectTopics`, `topicSchema` and `checkTopicReferences`; dashboard policies validate topics too.

## 0.12.1

### Patch Changes

- [#75](https://github.com/GuardBee/guardbee-mcp/pull/75) [`f3b785f`](https://github.com/GuardBee/guardbee-mcp/commit/f3b785fe9454f80720ec36468fee9f5b2e9a70ed) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - docs: add Chinese (ZH) README translation and short summaries in Japanese, Korean, Brazilian Portuguese, Spanish and German (JA.md, KO.md, PT-BR.md, ES.md, DE.md), with an eight-language switcher

## 0.12.0

### Minor Changes

- [#68](https://github.com/GuardBee/guardbee-mcp/pull/68) [`a1435e0`](https://github.com/GuardBee/guardbee-mcp/commit/a1435e0710466ba1d2c978dca7bfaca3923ee1a7) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - 38 more secret rules (76 in all): cloud and hosting (Azure AD client secret and storage key, DigitalOcean, Heroku, Fly.io, Cloudflare Origin CA, Supabase, PlanetScale), AI providers (OpenRouter, Groq, Perplexity, Replicate, Hugging Face org), developer tools (GitHub fine-grained, GitLab runner, PyPI, Vault, Terraform Cloud, Pulumi, Doppler, 1Password, age) and SaaS (Stripe webhook, Square, Shopify, Twilio API key, Linear, Notion, Atlassian, Sentry, Grafana, Postman, Discord webhook, Telegram bot). The fixed-format ones are also masked by security-proxy (66 formats, up from 32). Turkish providers iyzico, PayTR, Netgsm and İleti Merkezi are matched on their variable names and marked broad, so the scanner reports them and the proxy does not mask on them.

## 0.11.0

### Minor Changes

- [#59](https://github.com/GuardBee/guardbee-mcp/pull/59) [`64aeffa`](https://github.com/GuardBee/guardbee-mcp/commit/64aeffa43ce641738a9858818aa59d88154bf25a) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Quotas (`quotas`): caps on tool calls over a fixed window, counted across sessions per user (OIDC; the session without one), per session or for the whole gateway, matched on tool, upstream, label, user and group. Only calls about to reach the upstream count, a call counts against all matching quotas or none, and a full quota refuses with the time to retry. guard-core's policy schema gains `quotas`.

## 0.10.0

### Minor Changes

- [#55](https://github.com/GuardBee/guardbee-mcp/pull/55) [`20bbdc4`](https://github.com/GuardBee/guardbee-mcp/commit/20bbdc49affdebbbfce869d85176ab3b38aa23ce) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Sampling (`interceptors.sampling`, off by default): servers can ask the agent's model for a completion through the gateway, with guards. A request is answered only during one of that server's tool calls, by the calling session; `includeContext` is forced to `none`; `maxTokens` and requests per call are capped; what the server sends gets the injection scan; `approval` can ask the person first; and the model's answer is checked like egress (credentials and session data block it, personal data is masked). guard-core's policy schema gains `interceptors.sampling`.

## 0.9.0

### Minor Changes

- [#52](https://github.com/GuardBee/guardbee-mcp/pull/52) [`659b893`](https://github.com/GuardBee/guardbee-mcp/commit/659b893a82c92f6c579ea50de50b942448c23bea) Thanks [@4hmetuyar](https://github.com/4hmetuyar)! - Users over HTTP (`listen.oidc`): the proxy accepts JWTs from an OpenID Connect provider next to or instead of API keys, checking signature (JWKS via discovery), issuer, audience and lifetime. Rules can match `user` (glob) and `group`; audit events carry `user`; a session belongs to the user who opened it. A `401` points MCP clients at `/.well-known/oauth-protected-resource` (RFC 9728). guard-core's rule schema gains `match.user` and `match.group`.

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
