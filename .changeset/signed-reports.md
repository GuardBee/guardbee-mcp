---
"@guardbee/guard-core": minor
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-threat-rules": minor
---

Security reports: `guardbee-proxy report` builds a periodic report from the audit log (Markdown, HTML or JSON; English or Turkish) with findings mapped to OWASP Top 10 for LLM Applications (2025) and MITRE ATLAS, tied to the audit hash chain and optionally Ed25519-signed; `guardbee-proxy verify-report` checks it. The mapping (`classifyEvent`, `THREAT_CATEGORIES`) lives in guard-core and is shown by threat-rules' new `framework_map` tool.
