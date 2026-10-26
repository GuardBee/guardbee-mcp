import { readFileSync, statSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { languageOf, type SourceLanguage } from "@guardbee/guard-core";
import { OAUTH_AUDIT_PATTERNS, SPEC_SECTION, type OAuthAuditCategory } from "./patterns.js";

export interface Finding {
  patternId: string;
  patternName: string;
  category: OAuthAuditCategory;
  severity: "critical" | "high" | "medium";
  recommendation: string;
  file?: string;
  line: number;
  column: number;
  match: string;
  context: string;
  /** OWASP MCP Top 10 id. */
  owasp: string;
  /** The MCP spec Security Best Practices section the rule comes from. */
  reference: string;
  /** Source language of the file, when it is code. */
  language?: SourceLanguage;
}

export interface ScanResult {
  scannedFiles: number;
  skippedFiles: number;
  totalFindings: number;
  findings: Finding[];
  durationMs: number;
}

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".mp3", ".mp4", ".avi", ".mov", ".wav",
  ".ttf", ".woff", ".woff2", ".eot",
  ".lock",
]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", "dist", "build", ".next",
  "__pycache__", ".mypy_cache", ".pytest_cache", "venv", ".venv",
  "coverage", ".nyc_output",
]);
const MAX_FILE_SIZE = 1 * 1024 * 1024;
const MAX_CONTEXT_LENGTH = 240;
const MAX_CALL_SPAN = 2000;

function locationOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const lastNl = before.lastIndexOf("\n");
  const column = index - (lastNl === -1 ? 0 : lastNl + 1) + 1;
  return { line, column };
}

/** Walks forward from an opening '(' counting depth to find its matching close — string-unaware, a bounded heuristic like the rest of this family. */
function findMatchingParenEnd(text: string, openIndex: number): number {
  let depth = 0;
  const limit = Math.min(text.length, openIndex + MAX_CALL_SPAN);
  for (let i = openIndex; i < limit; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return limit;
}

/**
 * jwt.verify(token, secret [, options]) with no `audience` option means the
 * token's `aud` claim is never checked against this server's own identifier
 * — the MCP spec's named confused-deputy failure: a token issued for a
 * *different* resource server gets accepted here anyway.
 */
function checkMissingAudienceValidation(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /\bjwt\.verify\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const openParenIndex = m.index + m[0].length - 1;
    const callEnd = findMatchingParenEnd(text, openParenIndex);
    const callSpan = text.slice(m.index, callEnd);
    if (!/\baudience\s*:/i.test(callSpan)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "missing_audience_validation",
        patternName: "jwt.verify() call has no audience check",
        category: "token-validation",
        severity: "high",
        recommendation: "Without an `audience` option, jwt.verify() confirms the token is validly signed but never checks who it was issued *for*. A token minted for a completely different resource server will pass verification here just as well — pass { audience: <this server's own resource identifier> } explicitly.",
        file: filePath,
        line,
        column,
        match: callSpan.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
        context: "",
        owasp: "MCP07:2025",
        reference: SPEC_SECTION["token-validation"],
      });
    }
    re.lastIndex = m.index + 1;
  }

  // PyJWT: jwt.decode(token, key, algorithms=[...]) without audience=
  const pyRe = /\bjwt\.decode\s*\(/g;
  while ((m = pyRe.exec(text)) !== null) {
    const openParenIndex = m.index + m[0].length - 1;
    const callEnd = findMatchingParenEnd(text, openParenIndex);
    const callSpan = text.slice(m.index, callEnd);
    // authlib: jwt.decode(token, key, claims_options={"aud": {"essential": True, "value": ...}}) + claims.validate()
    const authlibAudience = /\bclaims_options\s*=/.test(callSpan) && /["']aud["']\s*:/.test(text);
    if (!/\baudience\s*=/i.test(callSpan) && !authlibAudience) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "python_missing_audience_validation",
        patternName: "Python jwt.decode() call has no audience check (PyJWT, python-jose, authlib)",
        category: "token-validation",
        severity: "high",
        recommendation:
          "jwt.decode without an audience accepts tokens minted for any resource server. Pass audience=<this server's resource identifier> (PyJWT, python-jose) or claims_options={\"aud\": {\"essential\": True, \"value\": ...}} and call claims.validate() (authlib).",
        file: filePath,
        line,
        column,
        match: callSpan.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
        context: "",
        owasp: "MCP07:2025",
        reference: SPEC_SECTION["token-validation"],
      });
    }
    pyRe.lastIndex = m.index + 1;
  }

  // golang-jwt / lestrrat jwx: jwt.Parse(token, keyFunc [, jwt.WithAudience(...)])
  const goRe = /\bjwt\.(?:Parse|ParseWithClaims|ParseString)\s*\(/g;
  const goAudience = /\bWithAudience\s*\(|\bVerifyAudience\s*\(|\bGetAudience\s*\(|\.Audience\b/.test(text);
  while (!goAudience && (m = goRe.exec(text)) !== null) {
    const callEnd = findMatchingParenEnd(text, m.index + m[0].length - 1);
    const callSpan = text.slice(m.index, callEnd);
    const { line, column } = locationOf(text, m.index);
    findings.push({
      patternId: "go_missing_audience_validation",
      patternName: "Go jwt.Parse() with no audience check",
      category: "token-validation",
      severity: "high",
      recommendation:
        "jwt.Parse checks the signature and expiry but not who the token was issued for. Pass jwt.WithAudience(<this server's resource identifier>) (golang-jwt v5, jwx) so a token minted for another resource server is refused.",
      file: filePath,
      line,
      column,
      match: callSpan.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
      context: "",
      owasp: "MCP07:2025",
      reference: SPEC_SECTION["token-validation"],
    });
  }
  return findings;
}

/**
 * An authorization request built with response_type=code but no
 * code_challenge nearby means PKCE isn't being used — required by OAuth 2.1
 * for every client type, not just public ones.
 */
function checkMissingPkce(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /response_type\s*=\s*code\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const windowStart = Math.max(0, m.index - 200);
    const windowEnd = Math.min(text.length, m.index + 400);
    const window = text.slice(windowStart, windowEnd);
    if (!/code_challenge/i.test(window)) {
      const { line, column } = locationOf(text, m.index);
      findings.push({
        patternId: "missing_pkce_on_auth_request",
        patternName: "Authorization request (response_type=code) built with no code_challenge nearby",
        category: "pkce",
        severity: "high",
        recommendation: "OAuth 2.1 requires PKCE (code_challenge/code_verifier) for every authorization_code flow, regardless of client type. Without it, an intercepted authorization code can be redeemed by whoever captured it.",
        file: filePath,
        line,
        column,
        match: text.slice(Math.max(0, m.index - 40), m.index + 40).trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
        context: "",
        owasp: "MCP07:2025",
        reference: SPEC_SECTION.pkce,
      });
    }
  }

  // authlib OAuth2Session / OAuth client and golang.org/x/oauth2: the authorization URL is built by a library call
  const libraryCall = /\bcreate_authorization_url\s*\(|\bauthorize_redirect\s*\(|\.AuthCodeURL\s*\(/.exec(text);
  if (libraryCall && !/code_challenge|code_verifier|S256ChallengeOption|GenerateVerifier|VerifierOption/.test(text)) {
    const { line, column } = locationOf(text, libraryCall.index);
    findings.push({
      patternId: "missing_pkce_on_auth_request",
      patternName: "Authorization URL built with no PKCE code_challenge",
      category: "pkce",
      severity: "high",
      recommendation:
        "OAuth 2.1 requires PKCE for every authorization_code flow. authlib: pass code_challenge_method=\"S256\" to the client and code_verifier= to create_authorization_url/fetch_token. golang.org/x/oauth2: verifier := oauth2.GenerateVerifier(); AuthCodeURL(state, oauth2.S256ChallengeOption(verifier)); Exchange(ctx, code, oauth2.VerifierOption(verifier)).",
      file: filePath,
      line,
      column,
      match: text.slice(libraryCall.index, findMatchingParenEnd(text, text.indexOf("(", libraryCall.index))).trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
      context: "",
      owasp: "MCP07:2025",
      reference: SPEC_SECTION.pkce,
    });
  }
  return findings;
}


type Draft = Omit<Finding, "owasp" | "reference" | "file" | "line" | "column" | "context"> & { owasp?: string };

function finding(text: string, index: number, draft: Draft, filePath?: string): Finding {
  const { line, column } = locationOf(text, index);
  return { owasp: "MCP07:2025", reference: SPEC_SECTION[draft.category], context: "", file: filePath, line, column, ...draft } as Finding;
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH);

/**
 * A client that redeems an authorization code without checking the `iss`
 * response parameter (RFC 9207) cannot tell which authorization server sent
 * it, so a malicious server it also talks to can mix the flows up.
 */
function checkMissingIssValidation(text: string, filePath?: string): Finding[] {
  const codeRead =
    /(?:searchParams|params|query)\.get\(\s*["']code["']\s*\)|\b(?:req|request)\.query\.code\b|\brequest\.args\.get\(\s*["']code["']\s*\)|\bQuery\(\)\.Get\(\s*"code"\s*\)|\bFormValue\(\s*"code"\s*\)/.exec(text);
  if (!codeRead) return [];
  const exchanges = /authorization_code|\.Exchange\s*\(\s*\w+\s*,/.test(text);
  const checksIss = /["'`]iss["'`]|\.iss\b|\biss\s*[:=!]=|\bauthorization_response_iss_parameter_supported\b/.test(text);
  if (!exchanges || checksIss) return [];
  return [
    finding(text, codeRead.index, {
      patternId: "missing_iss_validation",
      patternName: "Authorization response handled without checking the iss parameter (RFC 9207)",
      category: "mix-up",
      severity: "medium",
      recommendation: "Compare the authorization response's `iss` parameter with the issuer this flow was started against before redeeming the code (RFC 9207). Without it a client that talks to more than one authorization server can be tricked into sending a code to the wrong one (MCP spec: mix-up attacks).",
      match: clean(codeRead[0]),
    }, filePath),
  ];
}

/**
 * A URL the server handed over (the authorization URL) opened in a browser
 * with no check of its scheme: javascript:, data: or file: URLs run or read
 * things locally.
 */
function checkAuthUrlScheme(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /(?:(?<![.\w])open|\bopenExternal|\bwebbrowser\.open(?:_new_tab)?|(?<![.\w])opn|\bbrowser\.OpenURL)\s*\(\s*([A-Za-z_$][\w$.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const arg = m[1]!;
    if (!/url|uri|href|link|authoriz/i.test(arg)) continue;
    const before = text.slice(Math.max(0, m.index - 600), m.index);
    if (/\.protocol\b|startsWith\(\s*["'`]https?:|scheme\s*(?:===?|in|!==?)|\.Scheme\s*[!=]=|urlparse\(|["'`]https:["'`]|["'`]https["'`]/.test(before)) continue;
    findings.push(finding(text, m.index, {
      patternId: "auth_url_scheme_not_validated",
      patternName: "URL opened in a browser without checking its scheme",
      category: "auth-url",
      severity: "high",
      recommendation: "Parse the URL and allow only https: (and http: for localhost) before opening it. A malicious MCP server can return `javascript:`, `data:` or `file:` as its authorization URL (MCP spec: OAuth authorization URL validation).",
      match: clean(m[0]),
    }, filePath));
  }
  return findings;
}

/**
 * A record looked up by a handle that came in as a tool argument, with no
 * check that it belongs to the caller: any user who learns (or guesses) the
 * handle resumes someone else's flow.
 */
function checkStateHandleBinding(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const re = /\b[\w$]+\.get\(\s*(?:args|params|input|arguments|request\.params(?:\.arguments)?)\.([\w$]*(?:[Hh]andle|[Ss]ession_?[Ii]d|[Ss]tate)[\w$]*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const after = text.slice(m.index, Math.min(text.length, m.index + 500));
    if (/\b(?:userId|user_id|ownerId|owner|\.sub\b|authInfo|extra\.authInfo|clientId|principal|currentUser)\b/.test(after)) continue;
    findings.push(finding(text, m.index, {
      patternId: "state_handle_not_bound_to_user",
      patternName: "Handle from a tool argument used without checking it belongs to the caller",
      category: "state-handle",
      severity: "medium",
      recommendation: "Store the user (token subject, authInfo) with every handle you hand out, and refuse a lookup when the caller is not that user. A handle passed back as a tool argument is otherwise a bearer secret for someone else's session (MCP spec: state handle hijacking).",
      match: clean(m[0]),
    }, filePath));
  }
  return findings;
}

/** The first match of `re` (global) that is not on a `//` or `#` comment line. */
function firstOutsideComment(text: string, re: RegExp): RegExpExecArray | null {
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
    if (!/^\s*(?:\/\/|#|\*)/.test(text.slice(lineStart, m.index))) return m;
  }
  return null;
}

/** An MCP server reachable over HTTP: no auth, no Host/Origin check (DNS rebinding), or bound to every interface. */
function checkLocalHttpExposure(text: string, filePath?: string, language?: SourceLanguage): Finding[] {
  // Go: a package-qualified constructor call (server.NewStreamableHTTPServer(…), mcp.NewSSEHandler(…)), not the SDK's own definition or a doc comment
  const transport =
    language === "go"
      ? firstOutsideComment(text, /\b[a-z]\w*\.(?:NewStreamableHTTPHandler|NewSSEHandler|NewStreamableHTTPServer|NewSSEServer)\s*\(/g)
      : /\b(?:StreamableHTTPServerTransport|SSEServerTransport)\b|\b(?:mcp|server|app)\.run\(\s*transport\s*=\s*["'](?:streamable-http|sse|http)["']/.exec(text);
  const findings: Finding[] = [];
  if (transport) {
    if (!/authorization|bearer|requireBearerAuth|verifyToken|verifyAccessToken|authInfo|apiKey|api_key|auth_settings|token_verifier|AuthSettings/i.test(text)) {
      findings.push(finding(text, transport.index, {
        patternId: "local_http_server_unauthenticated",
        patternName: "HTTP MCP server with no authentication",
        category: "local-exposure",
        severity: "high",
        recommendation: "Require a bearer token (the SDK's requireBearerAuth / auth settings) on the HTTP endpoint, even on localhost: any page the user visits and any process on the machine can call an unauthenticated local server (MCP spec: local MCP server compromise).",
        match: clean(transport[0]),
      }, filePath));
    }
    if (!/enableDnsRebindingProtection|allowedHosts|allowedOrigins|headers\.origin|headers\[["']origin["']\]|headers\.host|["']Origin["']|TrustedHostMiddleware|allowed_hosts|\br\.Host\b|CrossOriginProtection/i.test(text)) {
      findings.push(finding(text, transport.index, {
        patternId: "missing_host_origin_check",
        patternName: "HTTP MCP server does not check Host or Origin (DNS rebinding)",
        category: "local-exposure",
        severity: "medium",
        recommendation: "Validate the Host and Origin headers (enableDnsRebindingProtection with allowedHosts / allowedOrigins in the TypeScript SDK, TrustedHostMiddleware in Starlette). Without it a web page can rebind its domain to 127.0.0.1 and talk to the local server from the user's browser.",
        match: clean(transport[0]),
      }, filePath));
    }
  }
  const listenAll = firstOutsideComment(
    text,
    /\.listen\(\s*[\w$.]+\s*,\s*["']0\.0\.0\.0["']|\bhost\s*[:=]\s*["']0\.0\.0\.0["']|\bListenAndServe(?:TLS)?\(\s*"(?:0\.0\.0\.0)?:\d+"|\bAddr\s*:\s*"(?:0\.0\.0\.0)?:\d+"/g,
  );
  if (listenAll && (transport || /\bMcpServer\b|\bFastMCP\b|modelcontextprotocol|mark3labs\/mcp-go/.test(text))) {
    findings.push(finding(text, listenAll.index, {
      patternId: "listen_all_interfaces",
      patternName: "MCP server listens on all interfaces (0.0.0.0)",
      category: "local-exposure",
      severity: "medium",
      recommendation: "Bind a local MCP server to 127.0.0.1 (in Go, \"127.0.0.1:8080\" rather than \":8080\"). 0.0.0.0 exposes it to every network the machine is on; if it has to be reachable, put authentication and a host allowlist in front of it.",
      match: clean(listenAll[0]),
    }, filePath));
  }
  return findings;
}

/**
 * The incoming Authorization header read into a variable and that variable
 * put on an outgoing request: the passthrough the one-expression patterns
 * cannot see (Python and Go).
 */
function checkIndirectPassthrough(text: string, filePath?: string): Finding[] {
  const findings: Finding[] = [];
  const read =
    /\b([A-Za-z_]\w*)\s*(?:,\s*\w+\s*)?:?=\s*(?:request|req|r)\.headers?(?:\.get\(\s*["']authorization["']|\[\s*["']authorization["']\s*\])|\b([A-Za-z_]\w*)\s*:?=\s*(?:r|req|request)\.Header\.Get\(\s*"Authorization"\s*\)/gi;
  for (const m of text.matchAll(read)) {
    const name = (m[1] ?? m[2])!;
    const rest = text.slice(m.index! + m[0].length);
    const forwarded = new RegExp(
      `["']Authorization["']\\s*:\\s*(?:f?["']Bearer \\{)?${name}\\b|\\.Header\\.(?:Set|Add)\\(\\s*"Authorization"\\s*,\\s*${name}\\b|["']Authorization["']\\s*:\\s*\\[\\]string\\{\\s*${name}\\b`,
    ).exec(rest);
    if (!forwarded) continue;
    findings.push(
      finding(text, m.index! + m[0].length + forwarded.index, {
        patternId: "token_passthrough_via_variable",
        patternName: "Incoming Authorization header stored in a variable and sent to a downstream request",
        category: "token-passthrough",
        severity: "critical",
        recommendation:
          "The client's token is read from this request and put on an outgoing one (MCP spec: token passthrough). Exchange it for a token scoped to the downstream API (RFC 8693) instead of forwarding it.",
        match: clean(`${m[0]} … ${forwarded[0]}`),
      }, filePath),
    );
  }
  return findings;
}

/** Go: the discovery URL built from a value the request supplied. */
function checkGoDiscoverySsrf(text: string, filePath?: string): Finding[] {
  if (!/\b(?:Query\(\)\.Get|FormValue|PathValue|RequireString|GetString)\s*\(/.test(text)) return [];
  // The URL is built inside the request call: http.Get(fmt.Sprintf("%s/.well-known/…", issuer)), http.NewRequest("GET", issuer+"/.well-known/…", nil)
  const discovery = /fmt\.Sprintf\(\s*"%s\/?\.well-known\/(?:oauth-authorization-server|openid-configuration)|[\w)\]]\s*\+\s*"\/\.well-known\/(?:oauth-authorization-server|openid-configuration)/;
  let built: { index: number; 0: string } | null = null;
  for (const call of text.matchAll(/\bhttp\.(?:Get|Head|NewRequest(?:WithContext)?)\(/g)) {
    const span = text.slice(call.index!, findMatchingParenEnd(text, call.index! + call[0].length - 1));
    const inner = discovery.exec(span);
    if (inner) {
      built = { index: call.index! + inner.index, 0: inner[0] };
      break;
    }
  }
  if (!built) return [];
  if (/\b(?:allow(?:ed)?_?(?:issuers?|hosts?|list)|allowedIssuers|trustedIssuers)\b/i.test(text)) return [];
  return [
    finding(text, built.index, {
      patternId: "go_oauth_discovery_ssrf",
      patternName: "Go: OAuth/OIDC discovery URL built from a request-supplied issuer",
      category: "discovery-ssrf",
      severity: "critical",
      recommendation:
        "Building the discovery URL from a value the caller supplied lets them point this server at internal or attacker-controlled hosts (SSRF). Check the issuer against an allowlist of known issuers before fetching.",
      match: clean(built[0]),
    }, filePath),
  ];
}

/**
 * Scans server or client source. The language comes from `filePath`'s
 * extension (or `language`); language-specific rules only run on their own
 * language, and every rule runs when the language is unknown.
 */
export function scanText(text: string, filePath?: string, language: SourceLanguage | undefined = filePath ? languageOf(filePath) : undefined): Finding[] {
  const findings: Finding[] = [];

  for (const p of OAUTH_AUDIT_PATTERNS) {
    if (p.language && language && p.language !== language) continue;
    const re = new RegExp(p.pattern.source, p.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matchStr = m[0];
      const { line, column } = locationOf(text, m.index);

      findings.push({
        patternId: p.id,
        patternName: p.name,
        category: p.category,
        severity: p.severity,
        recommendation: p.recommendation,
        file: filePath,
        line,
        column,
        match: matchStr.trim().replace(/\s+/g, " ").slice(0, MAX_CONTEXT_LENGTH),
        context: "",
        owasp: p.owasp ?? "MCP07:2025",
        reference: SPEC_SECTION[p.category],
      });

      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  findings.push(...checkMissingAudienceValidation(text, filePath));
  findings.push(...checkMissingPkce(text, filePath));
  findings.push(...checkMissingIssValidation(text, filePath));
  findings.push(...checkAuthUrlScheme(text, filePath));
  findings.push(...checkStateHandleBinding(text, filePath));
  findings.push(...checkLocalHttpExposure(text, filePath, language));
  findings.push(...checkIndirectPassthrough(text, filePath));
  findings.push(...checkGoDiscoverySsrf(text, filePath));

  return language ? findings.map((f) => ({ ...f, language })) : findings;
}

export function scanFile(filePath: string): { findings: Finding[]; skipped: boolean } {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return { findings: [], skipped: true };

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return { findings: [], skipped: true };
  }
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return { findings: [], skipped: true };

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { findings: [], skipped: true };
  }

  return { findings: scanText(content, filePath), skipped: false };
}

export function scanDirectory(
  dirPath: string,
  options: { maxFiles?: number; include?: string[]; exclude?: string[] } = {}
): ScanResult {
  const start = Date.now();
  const { maxFiles = 5000, include, exclude } = options;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error(`maxFiles must be a positive integer (got ${String(maxFiles)})`);
  }
  const allFindings: Finding[] = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  function walk(dir: string) {
    if (scannedFiles + skippedFiles >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (exclude?.some((ex) => entry.name === ex || fullPath.includes(ex))) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = relative(dirPath, fullPath);
        if (exclude?.some((ex) => relPath.includes(ex))) {
          skippedFiles++;
          continue;
        }
        if (include && !include.some((inc) => relPath.includes(inc))) {
          skippedFiles++;
          continue;
        }

        const { findings, skipped } = scanFile(fullPath);
        if (skipped) skippedFiles++;
        else {
          scannedFiles++;
          allFindings.push(...findings);
        }
      }
    }
  }

  walk(dirPath);

  return {
    scannedFiles,
    skippedFiles,
    totalFindings: allFindings.length,
    findings: allFindings,
    durationMs: Date.now() - start,
  };
}
