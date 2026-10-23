---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
---

Network egress control for HTTP upstreams (SSRF guard). Every connection the proxy makes to a Streamable HTTP upstream, including each redirect hop, is checked at connect time with the address pinned (no DNS rebinding window). Link-local (cloud metadata), unspecified and reserved addresses are always refused, in any encoding; `upstreams.<name>.network` adds `blockPrivate` (by default: a server configured on a public address may not reach private ones) and `mode: allowlist` with `allowHosts`. Refused connections are audit events (`ruleId: network:*`) with the destination. guard-core exports the shared guard: `classifyAddress`, `checkHost`, `checkAddress`, `guardedLookup`, `guardedFetch`.
