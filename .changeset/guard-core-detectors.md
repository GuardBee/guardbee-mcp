---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-prompt-injection-scanner": minor
"@guardbee/mcp-secret-scanner": patch
---

Shared detectors: one injection rule set, provider secrets, Turkish identifiers.

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
