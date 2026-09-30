---
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-toxic-flow-auditor": patch
"@guardbee/mcp-prompt-leak-scanner": patch
---

Move shared detectors into the new `@guardbee/guard-core` library.

security-proxy now validates PII matches before masking them: a TC Kimlik No must pass the official checksum, an IBAN must pass mod-97, and a card number must pass Luhn. Order numbers and other 11- or 16-digit values are no longer masked by mistake.

toxic-flow-auditor and prompt-leak-scanner now import tool classification and checksum validators from guard-core. Their behavior is unchanged.
