# @guardbee/guard-core

Shared detectors used by other GuardBee MCP packages. Not an MCP server on its own, just a library — you don't need to install this package directly.

It exists so the same rule runs everywhere: a static scanner flagging a pattern and the runtime proxy blocking it use one implementation.

## What's inside

| Export | Used by | Purpose |
|---|---|---|
| `maskPiiInText`, `maskPiiInValue`, `PII_PATTERNS` | security-proxy | Mask TC Kimlik No, IBAN, card, email, phone, API keys, JWTs in tool results |
| `isValidTcKimlik`, `isValidIban`, `isValidLuhn` | security-proxy, prompt-leak-scanner | Checksum validation after a regex match |
| `scanForPromptInjection`, `scanToolResult` | security-proxy | Direct and indirect prompt injection patterns |
| `classifyTool`, `CAPABILITY_RULES` | toxic-flow-auditor | Label a tool as untrusted-content / sensitive-data / exfiltration / destructive (lethal trifecta) |

## Checksum-validated masking

A regex alone masks any 11-digit number as a TC Kimlik No and any 16-digit number as a card. Each match is now checked before it is masked:

| Pattern | Check |
|---|---|
| TC Kimlik No | Official 10th/11th digit algorithm |
| IBAN | ISO 7064 MOD97-10 |
| Card number | Luhn |

A match that fails its check (an order number, a tracking code) is left unchanged.
