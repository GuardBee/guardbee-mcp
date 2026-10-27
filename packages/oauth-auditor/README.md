# @guardbee/mcp-oauth-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/TR.md) | [🇨🇳 中文](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/ZH.md) | [🇯🇵 日本語](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/JA.md) | [🇰🇷 한국어](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/KO.md) | [🇧🇷 Português](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/PT-BR.md) | [🇪🇸 Español](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/ES.md) | [🇩🇪 Deutsch](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/DE.md)

[![npm version](https://img.shields.io/npm/v/@guardbee/mcp-oauth-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-oauth-auditor)
[![npm downloads](https://img.shields.io/npm/dm/@guardbee/mcp-oauth-auditor.svg)](https://www.npmjs.com/package/@guardbee/mcp-oauth-auditor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/oauth-auditor/LICENSE)

An MCP (Model Context Protocol) server that scans an MCP server's own authorization code for **OAuth 2.1 anti-patterns named in the MCP specification's own Security Considerations section**.

The MCP spec doesn't leave this to guesswork — it explicitly calls out **token passthrough** (forwarding a client's token to a downstream API unchanged, instead of exchanging/re-scoping it) and **missing audience validation** (accepting a token whose `aud` claim was never issued for this server) as the central authorization failure modes for a server acting as an OAuth resource server. This package checks for exactly those two, plus three related anti-patterns in the same family.

> Telemetry is **off** by default. With `GUARDBEE_TELEMETRY=1` it sends the server, tool, success, duration and short parameter values such as a file path; longer strings and fields like `content`, `token` or `password` are replaced with a placeholder. See [`@guardbee/mcp-telemetry`](https://github.com/GuardBee/guardbee-mcp/blob/main/packages/telemetry/README.md).

```
Claude ──► oauth-auditor ──► Your MCP server's auth code
              │
              ├─ token-passthrough    (client's token forwarded unchanged downstream)
              ├─ token-validation     (jwt.verify() with no audience check)
              ├─ discovery-ssrf       (OAuth/OIDC discovery URL built from client input)
              ├─ pkce                 (authorization request missing code_challenge)
              ├─ redirect-validation  (redirect_uri checked with startsWith/includes, not exact match)
              └─ secrets-exposure     (hardcoded client_secret)
```

---

## Why these two specifically

**Token passthrough** matters because a token a client presented to *this* server was scoped and audienced for this server — not whatever downstream API the server's own tool handlers call next. Forwarding it unchanged means the downstream service is trusting a credential it never issued, on the basis of a server-side decision the original token issuer never approved.

**Missing audience validation** is the same failure from the other direction: `jwt.verify(token, key)` confirms a token's *signature* is valid, but says nothing about who it was issued *for*. Without an explicit `audience` check, a token minted for a completely unrelated resource server — one that happens to share the same issuer/signing key — will verify successfully here too. This is the textbook confused-deputy substitution the MCP spec is warning about.

The other three patterns are adjacent, concrete instances of the same "an MCP server's auth code trusts something it shouldn't" theme: an OAuth/OIDC discovery URL built from client-supplied input (the shape behind a real disclosed CVE), a redirect_uri validated with a prefix/substring check instead of an exact match (open-redirect bypass), and PKCE silently missing from an authorization request (required by OAuth 2.1 unconditionally, not just for public clients).

---

## Features

- **6 categories**: token-passthrough, token-validation, discovery-ssrf, pkce, redirect-validation, secrets-exposure
- Two of the checks (missing audience validation, missing PKCE) look for an **absence** near a call site rather than a fixed regex — they extract the full `jwt.verify(...)` call (or the authorization-request URL construction) and confirm `audience:` / `code_challenge` is genuinely nowhere nearby, not just matched by a lucky string position
- SARIF 2.1.0 output — CI/CD integration (GitHub Code Scanning, etc.)
- Config file support via `guardbee.yml`
- 18 unit tests — a positive and a negative (false-positive) scenario for every pattern, plus one fully-correct OAuth flow that produces zero findings. Found and fixed a real regex bug during development (a trailing `\b` after a `]` character that can never match, since `]` isn't a word character — silently missed the bracket-notation form of header access). End-to-end verified against a fixture with all 6 anti-patterns deliberately planted (caught all 6), and against the entire guardbee-mcp monorepo (401 files — zero findings in any real third-party code; the only non-test matches were the scanner's own pattern-definition source textually containing the string `jwt.verify(` inside a regex literal and a doc comment, not actual vulnerable usage)

---

## Quick Start

### Claude Desktop / MCP Client

```json
{
  "mcpServers": {
    "guardbee-oauth-auditor": {
      "command": "npx",
      "args": ["-y", "@guardbee/mcp-oauth-auditor"]
    }
  }
}
```

### CLI (CI/CD)

```bash
npx @guardbee/mcp-oauth-auditor scan ./src --fail-on=high --format=sarif > results.sarif
```

---

## MCP Tools

| Tool | Description |
|------|----------|
| `scan_text` | Scans a code snippet |
| `scan_file` | Scans a single file |
| `scan_directory` | Recursively scans a directory |
| `list_patterns` | Lists all supported patterns by category |

---

## Detected Patterns

| Category | Pattern | Severity | OWASP |
|---|---|---|---|
| token-passthrough | `token_passthrough_to_downstream` | critical | MCP07 |
| token-validation | `missing_audience_validation` | high | MCP07 |
| discovery-ssrf | `oauth_discovery_ssrf` | critical | MCP07 |
| pkce | `missing_pkce_on_auth_request` | high | MCP07 |
| redirect-validation | `loose_redirect_uri_validation` | high | MCP07 |
| secrets-exposure | `hardcoded_oauth_client_secret` | high | MCP07 |
| state-handle | `predictable_state_handle` (+ Python) — state / session handle from `Math.random`, `Date.now`, a counter | high | MCP07 |
| state-handle | `state_handle_not_bound_to_user` — a handle from a tool argument looked up with no check that it is the caller's | medium | MCP07 |
| mix-up | `missing_iss_validation` — authorization code redeemed without checking `iss` (RFC 9207) | medium | MCP07 |
| auth-url | `auth_url_scheme_not_validated` — a server-provided URL opened with no scheme check (`javascript:`, `data:`, `file:`) | high | MCP07 |
| auth-url | `auth_url_opened_via_shell` — URL interpolated into `open` / `xdg-open` / `start` through a shell | critical | MCP05 |
| local-exposure | `local_http_server_unauthenticated` — HTTP MCP transport with no authentication | high | MCP07 |
| local-exposure | `missing_host_origin_check` — no Host / Origin validation (DNS rebinding) | medium | MCP07 |
| local-exposure | `listen_all_interfaces` — MCP server bound to `0.0.0.0` | medium | MCP07 |

### Python and Go

The language comes from the file extension, and Python- and Go-specific rules run only on their own files.

- **Python** (FastAPI / Starlette / Flask, PyJWT, python-jose, authlib): `python_missing_audience_validation` (`jwt.decode` with no `audience=` and no authlib `claims_options` `aud`), `python_audience_verification_disabled` (`"verify_aud": False`), `python_token_passthrough_to_downstream` (the `Authorization` header or all of `request.headers` on a `requests` / `httpx` / client call), `missing_pkce_on_auth_request` on authlib `create_authorization_url` / `authorize_redirect` with no `code_challenge`, and the discovery SSRF, redirect, state and `0.0.0.0` rules.
- **Go** (golang-jwt / jwx, go-oidc, golang.org/x/oauth2, go-sdk and mcp-go HTTP transports): `go_missing_audience_validation` (`jwt.Parse` with no `jwt.WithAudience`), `go_oidc_client_id_check_skipped`, `go_token_passthrough_to_downstream` (`out.Header.Set("Authorization", r.Header.Get("Authorization"))`), `go_hardcoded_oauth_client_secret`, `go_loose_redirect_uri_validation` (`strings.HasPrefix`), `go_predictable_state_handle` (math/rand, time), `go_oauth_discovery_ssrf`, `go_auth_url_opened_via_shell`, `missing_pkce_on_auth_request` on `AuthCodeURL` with no `S256ChallengeOption`, and `ListenAndServe(":8080")` as `listen_all_interfaces`.
- **Both**: `token_passthrough_via_variable` — the incoming `Authorization` header read into a variable that is then put on an outgoing request.

Every finding links its section of the [MCP spec Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices) (SARIF `helpUri`) and carries its OWASP MCP Top 10 id as a SARIF tag. The newer rules are heuristics over one file at a time: a check done in another module (an auth middleware, an `iss` comparison in a helper) is not seen.

### Live probe

```bash
npx @guardbee/mcp-oauth-auditor probe http://127.0.0.1:3000/mcp
```

Read-only checks of a running HTTP MCP endpoint: does it answer an `initialize` without credentials (`probe_unauthenticated_access`), and does it accept a foreign `Host` (`probe_dns_rebinding_host_accepted`) or `Origin` (`probe_foreign_origin_accepted`)? It sends no credentials, calls nothing beyond `initialize`, closes any session it opened, and refuses a host that resolves to a public address unless `--allow-public`. CLI only: an agent cannot start it through the MCP tools.


---

## Configuration (`guardbee.yml`)

```yaml
oauth-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - ".test.ts"
```

---

## Limitations (by design)

- **TypeScript/JavaScript, Python and Go.** Each has rules for its common libraries (above). Other languages (Rust, Java, C#, …) and other libraries are only matched where they happen to share a shape with these, e.g. a literal `client_secret` or `response_type=code`.
- **Heuristic, not a full OAuth conformance test.** This finds specific anti-patterns in source, not a live protocol conformance check against a running authorization server. It won't catch every way an OAuth flow can be misimplemented — only the handful the MCP spec calls out as the highest-stakes ones.
- **The absence-based checks (audience, PKCE) use a bounded text window**, not a real parser — a `jwt.verify()` call whose options object happens to be built far away from the call site (a variable passed in, rather than an inline object) won't be checked for `audience` correctly.

---

## Development

```bash
npm run build
npm test
```

---

## License

MIT — [GuardBee](https://guardbee.ai)

## Feedback

Questions, ideas, or a false positive? Start a thread in [GitHub Discussions](https://github.com/GuardBee/guardbee-mcp/discussions) or [open an issue](https://github.com/GuardBee/guardbee-mcp/issues). If GuardBee is useful to you, a ⭐ on [the repository](https://github.com/GuardBee/guardbee-mcp) helps others find it.
