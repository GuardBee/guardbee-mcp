---
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-unbounded-consumption-auditor": patch
---

security-proxy: `profile: strict` in `guardbee-proxy.yaml` hardens the availability-first defaults: provenance is required, and Redis (`state`), the classifier and the judge refuse calls when they cannot answer (`onError` closed). Values written in the file still win. The README documents the default security profile (what rules-only, classifier and judge catch, every security-critical default and how to harden it, durable audit storage) and links a new capability matrix; `init`'s handling of Streamable HTTP servers is described consistently.

unbounded-consumption-auditor: Unbounded Consumption is referenced as OWASP LLM10:2025, the official id, instead of "LLM Top 10 2026 #6".
