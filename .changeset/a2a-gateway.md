---
"@guardbee/mcp-security-proxy": minor
---

A2A gateway: an `a2a:` section serves Agent2Agent agents at `<path>/<name>`. Callers must authenticate (API key or OIDC, with `allowGroups` per agent). Injection in messages and in returned tasks and artifacts is blocked or warned, including streamed responses event by event. Personal data is masked. Push-notification webhooks to private or metadata addresses are refused. Agent cards are rewritten to point at the gateway, and every call is audited. Covers A2A 1.0 and 0.3 JSON-RPC.
