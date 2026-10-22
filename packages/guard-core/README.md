# @guardbee/guard-core

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/guard-core.svg)](https://www.npmjs.com/package/@guardbee/guard-core)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/guard-core.svg)](https://www.npmjs.com/package/@guardbee/guard-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/guard-core/LICENSE)

Shared detectors used by other GuardBee MCP packages. Not an MCP server on its own, just a library — you don't need to install this package directly.

It exists so the same rule runs everywhere: a static scanner flagging a pattern and the runtime proxy blocking it use one implementation.

## What's inside

| Export | Used by | Purpose |
|---|---|---|
| `maskPiiInText`, `maskPiiInValue`, `PII_PATTERNS` | security-proxy | Mask TC Kimlik No, VKN, IBAN, card, phone, email, provider API keys, private keys, connection strings and JWTs in tool results; an optional replacer turns matches into tokens |
| `SpanLookup`, `ModelDetector`, `MODEL_PII` | @guardbee/ner, pii-bench | Mask what a model found (person names, via `@guardbee/ner`) in the same pass: run the model over the strings first, then pass a lookup as `maskPiiInText`'s fifth argument. A lookup must throw for a text it has no result for, so an unscanned text is never passed as clean. `person_name` is a detector name in the `ALL`, `KVKK` and `IDENTITY` presets; without a lookup it finds nothing |
| `SPECIAL_CATEGORIES`, preset `KVKK_SENSITIVE` | security-proxy, pii-bench | The nine KVKK Art. 6 special categories (health, religion and belief, ethnic origin, political opinion, union membership, criminal record, sex life, biometric, genetic): a term list per category, masked only when the text is about a person (a name from the lookup, a personal identifier, or a word that points at someone). Opt-in: in no preset but `KVKK_SENSITIVE` (`KVKK` plus these), or by name in `include` |
| `SECRET_RULES` | secret-scanner, security-proxy | 76 secret rules (provider keys and tokens — cloud, AI providers, developer tools, SaaS, Turkish payment and SMS providers — private keys, connection strings, JWT). The scanner reports all of them; the proxy masks the 66 that are not marked `broad` |
| `isValidTcKimlik`, `isValidVkn`, `isValidIban`, `isValidLuhn`, `isValidTrPhone` | security-proxy, prompt-leak-scanner | Validation after a regex match |
| `INJECTION_RULES`, `findInjections` | prompt-injection-scanner, security-proxy | 27 injection rules in English and Turkish, with base64-decoding; the scanner uses the 17 precise ones |
| `scanForPromptInjection`, `scanToolResult` | security-proxy | Block on a precise high/critical rule, warn on anything else |
| `gatewayPolicySchema`, `validatePolicy`, `policyShape` | security-proxy, app.guardbee.ai | The gateway policy document (labels, rules, taint, approval, defaults, interceptors). The dashboard validates an edit with it before saving, so a policy that saves is one the proxy accepts |
| `classifyTool`, `CAPABILITY_RULES` | toxic-flow-auditor, security-proxy | Label a tool as untrusted-content / sensitive-data / exfiltration / destructive (lethal trifecta) |

## Checksum-validated masking

A regex alone masks any 11-digit number as a TC Kimlik No and any 16-digit number as a card. Each match is now checked before it is masked:

| Pattern | Check |
|---|---|
| TC Kimlik No | Official 10th/11th digit algorithm |
| VKN (tax number) | Gelir İdaresi check digit, and a `VKN` / `Vergi No` label before the number |
| IBAN | ISO 7064 MOD97-10 |
| Card number | Luhn |
| Phone (TR) | Mobile (5xx), landline (2xx–4xx) or 850 code; written with a +90 / 0 prefix, an area code in parentheses, or grouped with spaces, dashes or dots, and not part of a URL or id. A bare 10-digit mobile number counts only after a word that says it is one (`numaram`, `tel`, `cep`, `iletişim`) |

A match that fails its check (an order number, a tracking code) is left unchanged.

## Encoded and disguised values

A value a tool returns encoded, or that someone writes to slip past a regex, is masked like the plain one:

- **Character escapes:** HTML entities (`&#49;`, `&#x31;`, `&commat;`), JS/JSON escapes (`\u0031`, `\x31`), URL escapes (`%40`; a lone `%50` between spaces stays a percentage).
- **Look-alike characters:** fullwidth and mathematical digits (NFKC), other scripts' digits (Arabic-Indic `١٢٣`, Devanagari `१२३`…), zero-width characters.
- **base64, base64url, hex:** a run that decodes to readable text is masked and encoded again in the same form (alphabet and padding kept), up to two encodings deep. Binary runs (hashes, images, keys) are left alone.
- **Separators and spelled-out forms:** `TC: 100 000 001 46` after a TC label, `+90.532.123.45.67`, `ahmet [at] example [dot] com`.

Detection runs on a decoded copy; masking maps back onto the characters as written, so everything around a value keeps its spelling. The replacer gets the decoded value, so a vault gives every spelling of a value the same token. Not covered: a value split across fields or reversed, and names inside an encoded run (the NER model sees the text as sent). pii-bench's bypass suite measures this (`pnpm --filter @guardbee/pii-bench bypass`).

## Precise and broad rules

Injection and secret rules carry a `broad` flag for patterns that also match ordinary text: "act as", "developer mode", any 40-character base64 run, a publishable Stripe key. Static scanners that show a finding to a person skip broad injection rules; the runtime proxy never blocks or masks on a broad rule, because a false match there would also mark the session as holding sensitive data or stop a legitimate call.

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
