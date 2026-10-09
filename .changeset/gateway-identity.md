---
"@guardbee/mcp-security-proxy": minor
"@guardbee/guard-core": minor
---

Users over HTTP (`listen.oidc`): the proxy accepts JWTs from an OpenID Connect provider next to or instead of API keys, checking signature (JWKS via discovery), issuer, audience and lifetime. Rules can match `user` (glob) and `group`; audit events carry `user`; a session belongs to the user who opened it. A `401` points MCP clients at `/.well-known/oauth-protected-resource` (RFC 9728). guard-core's rule schema gains `match.user` and `match.group`.
