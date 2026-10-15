---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-db-gateway": minor
---

Org-level PII patterns. `blockPatterns` mask an organization's own identifiers as numbered placeholders (`<CLIENT_NO_1>`); `allowPatterns` leave a detected value unmasked and are flagged in the audit log. Each pattern runs with a time budget: a block pattern over budget fails closed (result withheld, LLM gateway 502), an allow pattern over budget is skipped. Max 25 patterns of 200 characters; invalid regexes and categories named like built-in detectors fail validation. An LLM gateway request can add block patterns (`guardbee.blockPatterns`) but never allow patterns.
