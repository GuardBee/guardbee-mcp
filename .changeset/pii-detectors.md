---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
---

More PII detectors: passport, SGK/SSK/Bağ-Kur number, MERSİS number, date of birth and postal address (all label-gated), KEP address, and opt-in IP address, MAC address and Turkish vehicle plate (`piiMasking.include`). guard-core exports `PERSONAL_DATA_CATEGORIES` and `OPT_IN_PII`; every new category is counted in `piiHits`.
