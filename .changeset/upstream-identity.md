---
"@guardbee/mcp-security-proxy": minor
---

Upstream identity: each caller acts as themselves at HTTP upstreams, and their own token is never forwarded.

- `upstreams.<name>.auth.mode: token-exchange` exchanges the caller's OIDC access token (RFC 8693) for one with the upstream as audience. Tested against Keycloak.
- `oauth-per-user` lets each user connect their own account at a third-party OAuth server through a consent page the gateway serves (PKCE S256, signed single-use links, CSRF token, exact redirect URI, RFC 9207 `iss`, no framing). Tokens are stored encrypted (AES-256-GCM) and refreshed.
- Scope minimization: a call asks for `scopes` plus the called tool's `toolScopes`, and steps up on `insufficient_scope`. Elevations and consents are audit events (`auth:step-up`, `auth:consent`).
- Tool responses record `upstreamIdentity` next to `user`.
- New top-level `upstreamAuth` (`publicUrl`, `encryptionKeyEnv`, `tokenFile`).
