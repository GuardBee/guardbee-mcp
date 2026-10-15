---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-db-gateway": minor
---

PII category presets. guard-core exports `PII_PRESETS` (`ALL`, `KVKK`, `IDENTITY`, `IDENTIFIERS`, `SECRETS`), `piiScope({ preset, enable, disable })` and a config schema that rejects unknown preset or detector names. security-proxy takes `interceptors.piiMasking.preset` / `enable` / `disable`, with `piiMasking.upstreams.<name>` per upstream or LLM provider; detection stays complete (taint, `piiHits`), only masking narrows. db-gateway gets `piiScan`: value-based masking of PII inside text columns no field rule covers, off by default, also set with `GATEWAY_PII_SCAN`.
