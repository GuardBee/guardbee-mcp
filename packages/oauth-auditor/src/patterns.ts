export type OAuthAuditCategory =
  | "token-passthrough"
  | "token-validation"
  | "discovery-ssrf"
  | "pkce"
  | "redirect-validation"
  | "secrets-exposure"
  | "state-handle"
  | "mix-up"
  | "auth-url"
  | "local-exposure";

const SPEC = "https://modelcontextprotocol.io/specification/draft/basic/security_best_practices";
/** The MCP spec Security Best Practices section each finding comes from. */
export const SPEC_SECTION: Record<OAuthAuditCategory, string> = {
  "token-passthrough": `${SPEC}#token-passthrough`,
  "token-validation": `${SPEC}#confused-deputy-problem`,
  "discovery-ssrf": `${SPEC}#ssrf-against-authorization-servers`,
  pkce: `${SPEC}#confused-deputy-problem`,
  "redirect-validation": `${SPEC}#localhost-redirect-uri-impersonation`,
  "secrets-exposure": `${SPEC}#token-passthrough`,
  "state-handle": `${SPEC}#state-handle-hijacking`,
  "mix-up": `${SPEC}#mix-up-attacks`,
  "auth-url": `${SPEC}#oauth-authorization-url-validation`,
  "local-exposure": `${SPEC}#local-mcp-server-compromise`,
};

export interface OAuthAuditPattern {
  id: string;
  name: string;
  category: OAuthAuditCategory;
  pattern: RegExp;
  severity: "critical" | "high" | "medium";
  recommendation: string;
  /** OWASP MCP Top 10 id; MCP07:2025 (insufficient authentication & authorization) unless set. */
  owasp?: string;
  /** Applies to files of this language only (when the file's language is known). */
  language?: "python" | "go";
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
    id: "python_token_passthrough_to_downstream",
    name: "Python: incoming Authorization header forwarded unchanged via requests/httpx",
    category: "token-passthrough",
    pattern:
      /\b(?:requests|httpx|session|client|\w+_client)\.(?:get|post|put|patch|delete|request|stream)\s*\([^;]{0,300}?(?:headers\s*=\s*\{[^}]{0,200}?["']Authorization["']\s*:\s*(?:request\.headers|headers)\s*(?:\[[^\]]+\]|\.get\s*\()|Authorization["']\s*:\s*request\.headers|headers\s*=\s*(?:dict\(\s*)?request\.headers\b)/gis,
    severity: "critical",
    language: "python",
    recommendation:
      "Python FastAPI/Starlette handlers that relay request.headers['Authorization'] into requests/httpx are the same MCP confused-deputy token-passthrough risk. Exchange for a downstream-scoped token instead of forwarding the client token.",
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
    id: "python_oauth_discovery_ssrf",
    name: "Python: OAuth/OIDC discovery fetched from a request-derived URL",
    category: "discovery-ssrf",
    pattern:
      /(?:requests|httpx)\.(?:get|request)\s*\(\s*(?:f["'][^"']*\.well-known\/(?:oauth-authorization-server|openid-configuration)[^"']*\{|(?:["'][^"']*\.well-known\/(?:oauth-authorization-server|openid-configuration)[^"']*["']\s*%|\.format\s*\())/gi,
    severity: "critical",
    language: "python",
    recommendation:
      "Building the discovery URL from client-supplied issuer/resource values in Python enables SSRF. Allowlist known issuers before any fetch.",
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
    id: "python_loose_redirect_uri_validation",
    name: "Python: redirect_uri validated with startswith/in instead of exact match",
    category: "redirect-validation",
    pattern: /redirect_uri[\s\S]{0,100}?\.(?:startswith|endswith)\s*\(|redirect_uri\s+in\s+/gi,
    severity: "high",
    language: "python",
    recommendation:
      "Python startswith/in checks on redirect_uri are classic open-redirect bypasses. Compare against the exact pre-registered redirect URI(s).",
  },
  {
    id: "hardcoded_oauth_client_secret",
    name: "OAuth client_secret has a hardcoded literal value",
    category: "secrets-exposure",
    pattern: /\bclient_secret\s*[:=]\s*["'][^"']{8,}["']/g,
    severity: "high",
    recommendation: "A hardcoded client_secret ships with the source/config and is visible to anyone who can read it. Load it from environment/secret storage at runtime instead — and for a public client (a CLI, a browser app, an MCP client without a secure backend), use PKCE with no client_secret at all rather than embedding one.",
  },
  {
    id: "predictable_state_handle",
    name: "OAuth state / session handle generated with Math.random, Date.now or a counter",
    category: "state-handle",
    pattern: /\b(?:state|handle|sessionId|session_id|stateHandle)\s*[:=]\s*(?:String\(\s*|`\$\{\s*)?(?:Math\.random\(\)|Date\.now\(\)|\+\+\w+|\w+\+\+|uuidv1\(\)|uuid\.v1\(\))/g,
    severity: "high",
    recommendation: "A handle an attacker can guess or enumerate lets them resume or hijack another user's authorization flow (MCP spec: state handle hijacking). Generate it with a CSPRNG (crypto.randomUUID(), crypto.randomBytes(32)) and bind it to the user who started the flow.",
  },
  {
    id: "python_predictable_state_handle",
    name: "Python: OAuth state / session handle generated with random, time or a counter",
    category: "state-handle",
    pattern: /\b(?:state|handle|session_id)\s*=\s*(?:str\(\s*)?(?:random\.(?:random|randint|choice)\(|time\.time\(\)|uuid\.uuid1\(\))/g,
    severity: "high",
    language: "python",
    recommendation: "Use secrets.token_urlsafe() for state and session handles, and bind them to the user who started the flow; random, time and uuid1 values can be guessed.",
  },
  {
    id: "python_audience_verification_disabled",
    name: "Python: JWT audience verification switched off (verify_aud: False)",
    category: "token-validation",
    pattern: /["']verify_aud["']\s*:\s*False\b/g,
    severity: "high",
    language: "python",
    recommendation:
      "verify_aud: False accepts a token minted for any resource server (confused deputy). Keep audience verification on and pass audience=<this server's resource identifier>.",
  },
  {
    id: "go_token_passthrough_to_downstream",
    name: "Go: incoming Authorization header copied onto a downstream request",
    category: "token-passthrough",
    pattern: /\.Header\.(?:Set|Add)\(\s*"Authorization"\s*,\s*[\w.]+\.Header\.Get\(\s*"Authorization"\s*\)|\.Header\s*=\s*\w+\.Header(?:\.Clone\(\))?\s*$/gm,
    severity: "critical",
    language: "go",
    recommendation:
      "The token a client presented to this server is forwarded unchanged to a downstream API (MCP spec: token passthrough). Exchange it for a token scoped to the downstream service (RFC 8693) instead of copying the Authorization header.",
  },
  {
    id: "go_oidc_client_id_check_skipped",
    name: "Go: go-oidc verifier built with SkipClientIDCheck (no audience check)",
    category: "token-validation",
    pattern: /\bSkipClientIDCheck\s*:\s*true\b/g,
    severity: "high",
    language: "go",
    recommendation:
      "SkipClientIDCheck: true makes the verifier accept ID tokens issued for any client — the audience is never checked. Set ClientID to this server's identifier instead.",
  },
  {
    id: "go_hardcoded_oauth_client_secret",
    name: "Go: oauth2.Config ClientSecret has a hardcoded literal value",
    category: "secrets-exposure",
    pattern: /\bClientSecret\s*:\s*"[^"]{8,}"/g,
    severity: "high",
    language: "go",
    recommendation: "A hardcoded client secret ships with the binary and the source. Read it from the environment or a secret store at startup; a public client should use PKCE with no secret.",
  },
  {
    id: "go_loose_redirect_uri_validation",
    name: "Go: redirect URI validated with strings.HasPrefix/Contains instead of exact match",
    category: "redirect-validation",
    pattern: /\bstrings\.(?:HasPrefix|Contains|HasSuffix)\(\s*[\w.]*[Rr]edirect/g,
    severity: "high",
    language: "go",
    recommendation: "A prefix or substring check on the redirect URI lets `https://legit.com.evil.com` style values through. Compare against the exact registered redirect URI(s).",
  },
  {
    id: "go_predictable_state_handle",
    name: "Go: OAuth state / session handle generated with math/rand or time",
    category: "state-handle",
    pattern: /\b(?:state|handle|sessionID|sessionId|stateHandle)\s*:?=\s*(?:strconv\.\w+\(\s*|fmt\.Sprint\w*\([^)]*?)?(?:rand\.(?:Intn|Int63n?|Int31n?|Uint32|Uint64|Float64)\(|rand\.Int\((?!\s*rand\.Reader)|time\.Now\(\)\.Unix)/g,
    severity: "high",
    language: "go",
    recommendation: "math/rand and timestamps can be guessed. Generate state and session handles with crypto/rand (rand.Text(), or 32 bytes from rand.Read) and bind them to the user who started the flow.",
  },
  {
    id: "go_auth_url_opened_via_shell",
    name: "Go: authorization URL opened through a shell (sh -c open / cmd /c start)",
    category: "auth-url",
    pattern: /\bexec\.Command(?:Context)?\(\s*(?:ctx\s*,\s*)?(?:"(?:sh|bash)"\s*,\s*"-c"\s*,\s*(?:"(?:open|xdg-open)\s[^"]*"\s*\+|fmt\.Sprintf\(\s*"(?:open|xdg-open)\s)|"cmd(?:\.exe)?"\s*,\s*"\/c"\s*,\s*"start")/g,
    severity: "critical",
    language: "go",
    recommendation:
      "A server-supplied authorization URL handed to a shell is command injection (`&calc`, `$(…)`). Validate the URL (https only) and open it without a shell: exec.Command(\"xdg-open\", url) / (\"open\", url), or rundll32 url.dll,FileProtocolHandler on Windows.",
    owasp: "MCP05:2025",
  },
  {
    id: "auth_url_opened_via_shell",
    name: "Authorization URL opened through a shell command (open / xdg-open / start)",
    category: "auth-url",
    pattern: /\b(?:exec|execSync|spawn|spawnSync)\s*\(\s*(?:`(?:open|xdg-open|start|cmd(?:\.exe)?\s+\/c\s+start)\s[^`]*\$\{|["'](?:open|xdg-open|start|cmd(?:\.exe)?\s+\/c\s+start)\s+["']?\s*\+)|\bos\.system\s*\(\s*f?["'](?:open|xdg-open|start)\s|\bsubprocess\.\w+\s*\(\s*f["'](?:open|xdg-open|start)\s[^"']*\{/g,
    severity: "critical",
    recommendation: "A server-supplied authorization URL interpolated into a shell command is command injection: a URL with `\"; rm -rf ~` or `&calc` runs on the user's machine (MCP spec: OAuth authorization URL validation). Validate the URL (https only) and open it without a shell: the `open` package, execFile/spawn with an argument array, or webbrowser.open in Python.",
    owasp: "MCP05:2025",
  },
];
