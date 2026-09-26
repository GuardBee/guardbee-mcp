export type OAuthAuditCategory =
  | "token-passthrough"
  | "token-validation"
  | "discovery-ssrf"
  | "pkce"
  | "redirect-validation"
  | "secrets-exposure";

export interface OAuthAuditPattern {
  id: string;
  name: string;
  category: OAuthAuditCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  recommendation: string;
}

/**
 * The MCP specification's own Security Considerations section names two
 * authorization failure modes as the central risk for a server acting as an
 * OAuth resource server: **token passthrough** (forwarding a client's token
 * to a downstream API unchanged, instead of exchanging/re-scoping it) and
 * **missing audience validation** (accepting a token whose `aud` claim was
 * never issued for this server, so a token meant for a different resource
 * server gets replayed here — the classic confused-deputy substitution).
 * The four patterns below are the ones expressible as a flat regex; audience
 * validation and PKCE enforcement need to check for an *absence* near a call
 * site instead, so those two live in scanner.ts as dedicated checks.
 */
export const OAUTH_AUDIT_PATTERNS: OAuthAuditPattern[] = [
  {
    id: "token_passthrough_to_downstream",
    name: "Incoming Authorization header forwarded unchanged to a downstream request",
    category: "token-passthrough",
    pattern: /\b(?:fetch|axios(?:\.\w+)?)\s*\([^;]{0,300}?Authorization["'`]?\s*:\s*(?:req\.headers(?:\.authorization\b|\[\s*["']authorization["']\s*\])|request\.headers\.authorization\b)/gis,
    severity: "critical",
    recommendation: "The MCP spec explicitly calls out token passthrough as a confused-deputy risk: a token a client presented to this server is being forwarded, unchanged, to a different downstream API. That token was scoped/audienced for this server, not the one it's now being sent to. Exchange it for a token scoped to the downstream service instead of relaying the original.",
  },
  {
    id: "oauth_discovery_ssrf",
    name: "OAuth/OIDC discovery document fetched from a request-derived URL",
    category: "discovery-ssrf",
    pattern: /(?:fetch|axios(?:\.\w+)?)\s*\(\s*`[^`]*\.well-known\/(?:oauth-authorization-server|openid-configuration)[^`]*\$\{\s*(?:req\.|request\.|params\.|query\.)/gi,
    severity: "critical",
    recommendation: "Building the OAuth/OIDC discovery URL from a client-supplied value (issuer, resource, etc.) lets a caller point this server at an arbitrary internal or attacker-controlled host — this is the same shape as CVE-2026-45609. Validate the value against an allowlist of known-good issuers before using it to build any URL this server fetches.",
  },
  {
    id: "loose_redirect_uri_validation",
    name: "redirect_uri validated with startsWith/includes instead of exact match",
    category: "redirect-validation",
    pattern: /redirect_uri[\s\S]{0,80}?\.(?:startsWith|includes)\s*\(/gi,
    severity: "high",
    recommendation: "A prefix/substring check on redirect_uri (instead of an exact match against a registered allowlist) is a classic open-redirect bypass — `https://legit.com.evil.com` or `https://legit.com/../evil` style values can pass. Compare against the exact, pre-registered redirect URI(s).",
  },
  {
    id: "hardcoded_oauth_client_secret",
    name: "OAuth client_secret has a hardcoded literal value",
    category: "secrets-exposure",
    pattern: /\bclient_secret\s*[:=]\s*["'][^"']{8,}["']/g,
    severity: "high",
    recommendation: "A hardcoded client_secret ships with the source/config and is visible to anyone who can read it. Load it from environment/secret storage at runtime instead — and for a public client (a CLI, a browser app, an MCP client without a secure backend), use PKCE with no client_secret at all rather than embedding one.",
  },
];
