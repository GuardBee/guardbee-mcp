# @guardbee/guard-core

Shared detectors used by other GuardBee MCP packages. Not an MCP server on its own, just a library — you don't need to install this package directly.

It exists so the same rule runs everywhere: a static scanner flagging a pattern and the runtime proxy blocking it use one implementation.

## What's inside

| Export | Used by | Purpose |
|---|---|---|
| `maskPiiInText`, `maskPiiInValue`, `PII_PATTERNS` | security-proxy | Mask TC Kimlik No, VKN, IBAN, card, phone, email, provider API keys, private keys, connection strings and JWTs in tool results; an optional replacer turns matches into tokens |
| `SECRET_RULES` | secret-scanner, security-proxy | 38 secret rules (provider keys and tokens, private keys, connection strings, JWT). The scanner reports all of them; the proxy masks the 32 that are not marked `broad` |
| `isValidTcKimlik`, `isValidVkn`, `isValidIban`, `isValidLuhn`, `isValidTrPhone` | security-proxy, prompt-leak-scanner | Validation after a regex match |
| `INJECTION_RULES`, `findInjections` | prompt-injection-scanner, security-proxy | 27 injection rules in English and Turkish, with base64-decoding; the scanner uses the 17 precise ones |
| `scanForPromptInjection`, `scanToolResult` | security-proxy | Block on a precise high/critical rule, warn on anything else |
| `classifyTool`, `CAPABILITY_RULES` | toxic-flow-auditor, security-proxy | Label a tool as untrusted-content / sensitive-data / exfiltration / destructive (lethal trifecta) |

## Checksum-validated masking

A regex alone masks any 11-digit number as a TC Kimlik No and any 16-digit number as a card. Each match is now checked before it is masked:

| Pattern | Check |
|---|---|
| TC Kimlik No | Official 10th/11th digit algorithm |
| VKN (tax number) | Gelir İdaresi check digit, and a `VKN` / `Vergi No` label before the number |
| IBAN | ISO 7064 MOD97-10 |
| Card number | Luhn |
| Phone (TR) | Mobile (5xx), landline (2xx–4xx) or 850 code after the +90 / 0 prefix |

A match that fails its check (an order number, a tracking code) is left unchanged.

## Precise and broad rules

Injection and secret rules carry a `broad` flag for patterns that also match ordinary text: "act as", "developer mode", any 40-character base64 run, a publishable Stripe key. Static scanners that show a finding to a person skip broad injection rules; the runtime proxy never blocks or masks on a broad rule, because a false match there would also mark the session as holding sensitive data or stop a legitimate call.
