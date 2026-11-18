---
"@guardbee/mcp-security-proxy": minor
"@guardbee/mcp-config-auditor": minor
---

security-proxy (#309, bypass and resilience):
- Approvals over MCP 2026-07-28 are single-use: a signed `requestState` and its answer sent again no longer run the approved call a second time. Each state carries a nonce and is accepted once, in the process and across replicas through the shared `state` counters.
- `guardbee-proxy init` records what it leaves outside the proxy (SSE, disabled, below `--min-grade`) in the audit log; `guardbee-proxy report` lists the latest run's servers under "MCP servers outside the proxy".
- With `audit.includePayloads: true`, credentials in logged arguments and results are masked (personal data is kept as before).
- Upstream error messages are masked like results before they reach the agent or a trace span.
- The client config backup `init` writes is mode 0600.
- A SIEM or dashboard queue that overflows during an outage warns once, and reports how many events were dropped when the destination is back.
- README: Bypass and Resilience section.

mcp-config-auditor: new `proxy_bypass` finding (high, MCP09:2025) for a server that runs next to the GuardBee gateway in the same client config instead of behind it.
