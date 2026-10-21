---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": patch
---

PII masking now sees through encodings and disguises (#166): base64, base64url and hex runs that decode to readable text are masked and encoded again in the same form; HTML entities, JS/JSON `\u` escapes and URL escapes, and Arabic-Indic, Devanagari and other scripts' digits are decoded before detection, with masking mapped back onto the original characters. TC Kimlik numbers written with separators after a TC label, phones grouped with dots and spelled-out e-mail addresses (`[at]`, `(at)`, `at … dot`) are found too. pii-bench's new bypass suite masks 80 of 80 cases (23 before) with no change to 16 encoded-looking clean strings.
