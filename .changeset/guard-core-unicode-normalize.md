---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": patch
---

PII and secret masking now sees through Unicode look-alikes: fullwidth digits, mathematical bold letters and zero-width characters inside a TC kimlik, IBAN, e-mail or API key no longer bypass the detectors. Detection runs on an NFKC copy with invisible characters removed and maps back to the original text, so unmasked text keeps its original spelling and every spelling of a value gets the same token.
