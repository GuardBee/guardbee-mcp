---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
---

Quotas (`quotas`): caps on tool calls over a fixed window, counted across sessions per user (OIDC; the session without one), per session or for the whole gateway, matched on tool, upstream, label, user and group. Only calls about to reach the upstream count, a call counts against all matching quotas or none, and a full quota refuses with the time to retry. guard-core's policy schema gains `quotas`.
