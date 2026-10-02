---
"@guardbee/mcp-security-proxy": minor
---

Approvals in the GuardBee dashboard.

`approval.channels: [elicitation, dashboard]` (with `audit.dashboard` configured) sends an approval request to the dashboard when the client cannot show a prompt. The arguments go PII-masked, the dashboard notifies workspace owners and admins, and the proxy polls until the request is approved, denied or expired, or `timeoutSeconds` passes. Channels are tried in order; a channel that cannot ask (no elicitation support, dashboard unreachable) falls through to the next one. Requires app.guardbee.ai with the gateway approvals endpoint.
