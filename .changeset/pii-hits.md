---
"@guardbee/mcp-security-proxy": minor
---

Audit events for tool responses and resource reads that contained personal data now carry `piiHits`: a count per category (`tc_kimlik`, `vkn`, `iban`, `credit_card`, `email`, `phone_tr`, and `secret` for credentials). Counts only, never values; counted even with masking off. The GuardBee dashboard's KVKK report is built from them.
