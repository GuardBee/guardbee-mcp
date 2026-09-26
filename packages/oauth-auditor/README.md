# @guardbee/mcp-oauth-auditor

**🇬🇧 English** | [🇹🇷 Türkçe](TR.md)

An MCP (Model Context Protocol) server that scans an MCP server's own authorization code for **OAuth 2.1 anti-patterns named in the MCP specification's own Security Considerations section**.

The MCP spec doesn't leave this to guesswork — it explicitly calls out **token passthrough** (forwarding a client's token to a downstream API unchanged, instead of exchanging/re-scoping it) and **missing audience validation** (accepting a token whose `aud` claim was never issued for this server) as the central authorization failure modes for a server acting as an OAuth resource server. This package checks for exactly those two, plus three related anti-patterns in the same family.

> This package sends usage telemetry by default (tool name + short parameters, scanned code is never included — see [`@guardbee/mcp-telemetry`](../telemetry/README.md)). Disable with `GUARDBEE_TELEMETRY=0`.

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

| Category | Pattern | Severity |
|---|---|---|
| token-passthrough | `token_passthrough_to_downstream` | critical |
| token-validation | `missing_audience_validation` | high |
| discovery-ssrf | `oauth_discovery_ssrf` | critical |
| pkce | `missing_pkce_on_auth_request` | high |
| redirect-validation | `loose_redirect_uri_validation` | high |
| secrets-exposure | `hardcoded_oauth_client_secret` | high |

---

## Configuration (`guardbee.yml`)

```yaml
oauth-auditor:
  fail-on: high       # any | critical | high | medium | none
  max-files: 5000
  exclude:
    - "**/*.test.ts"
```

---

## Limitations (by design)

- **JS/TS-oriented patterns.** `jwt.verify(`, `fetch(`/`axios(`, template-literal URL construction — a server written in Python/Go/Rust with equivalent bugs won't be recognized by name, only by the same underlying shape if it happens to use similarly-named functions.
- **Heuristic, not a full OAuth conformance test.** This finds specific anti-patterns in source, not a live protocol conformance check against a running authorization server. It won't catch every way an OAuth flow can be misimplemented — only the handful the MCP spec calls out as the highest-stakes ones.
- **The absence-based checks (audience, PKCE) use a bounded text window**, not a real parser — a `jwt.verify()` call whose options object happens to be built far away from the call site (a variable passed in, rather than an inline object) won't be checked for `audience` correctly.

---

## Development

```bash
npm run build
npm test             # 18 unit tests
```

---

## License

MIT — [GuardBee](https://guardbee.ai)
