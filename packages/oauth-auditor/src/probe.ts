import { lookup } from "dns/promises";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { isIP } from "net";
import { SPEC_SECTION } from "./patterns.js";
import type { Finding } from "./scanner.js";

/**
 * A live, read-only check of an HTTP MCP endpoint: does it answer an
 * `initialize` with no credentials, and does it accept a foreign Host or
 * Origin header (DNS rebinding)? Nothing is called beyond `initialize`, and
 * the session it may open is closed again.
 */
export interface ProbeOptions {
  /** Allow a host that resolves to a public address. Off: localhost and private networks only. */
  allowPublic?: boolean;
  timeoutMs?: number;
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "guardbee-oauth-auditor-probe", version: "1" } },
});

/** Loopback, RFC 1918, link-local, unique-local (fc00::/7) and CGNAT addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

interface Answer {
  status: number;
  sessionId?: string;
}

function post(url: URL, headers: Record<string, string>, timeoutMs: number, method = "POST", body: string | null = INITIALIZE): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method,
        timeout: timeoutMs,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      },
      (res) => {
        const sessionId = res.headers["mcp-session-id"];
        res.resume();
        resolve({ status: res.statusCode ?? 0, ...(typeof sessionId === "string" ? { sessionId } : {}) });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

const accepted = (answer: Answer) => answer.status >= 200 && answer.status < 300;

export async function probeEndpoint(target: string, options: ProbeOptions = {}): Promise<Finding[]> {
  const url = new URL(target);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`probe needs an http(s) URL, got ${url.protocol}`);
  const timeoutMs = options.timeoutMs ?? 5000;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!options.allowPublic && !addresses.every(isPrivateAddress)) {
    throw new Error(`${host} resolves to a public address (${addresses.join(", ")}); probe only checks local and private servers unless --allow-public`);
  }

  const findings: Finding[] = [];
  const opened: string[] = [];
  const add = (patternId: string, patternName: string, severity: Finding["severity"], recommendation: string, match: string) =>
    findings.push({ patternId, patternName, category: "local-exposure", severity, recommendation, file: target, line: 1, column: 1, match, context: "", owasp: "MCP07:2025", reference: SPEC_SECTION["local-exposure"] });

  try {
    const plain = await post(url, {}, timeoutMs);
    if (plain.sessionId) opened.push(plain.sessionId);
    if (accepted(plain)) {
      add("probe_unauthenticated_access", "Endpoint answers initialize with no credentials", "high",
        "The server accepted an MCP initialize with no Authorization header. Require a bearer token on the HTTP transport, even on localhost: a web page or another local process can call it otherwise (MCP spec: local MCP server compromise).",
        `POST ${url.pathname} → ${plain.status} without credentials`);
    }
    const rebound = await post(url, { host: "attacker.example" }, timeoutMs);
    if (rebound.sessionId) opened.push(rebound.sessionId);
    if (accepted(rebound)) {
      add("probe_dns_rebinding_host_accepted", "Endpoint accepts a foreign Host header (DNS rebinding)", "medium",
        "A request with Host: attacker.example was answered. After a DNS rebind, a page on that domain reaches this server from the user's browser. Allow only the hosts you serve (enableDnsRebindingProtection + allowedHosts, TrustedHostMiddleware).",
        `Host: attacker.example → ${rebound.status}`);
    }
    const foreign = await post(url, { origin: "http://attacker.example" }, timeoutMs);
    if (foreign.sessionId) opened.push(foreign.sessionId);
    if (accepted(foreign)) {
      add("probe_foreign_origin_accepted", "Endpoint accepts a request from a foreign Origin", "medium",
        "A request with Origin: http://attacker.example was answered. Reject Origins you do not expect (allowedOrigins), so a web page cannot drive the server from the user's browser.",
        `Origin: http://attacker.example → ${foreign.status}`);
    }
  } finally {
    // Close any session initialize opened (Streamable HTTP: DELETE with the session id)
    await Promise.allSettled(opened.map((id) => post(url, { "mcp-session-id": id }, timeoutMs, "DELETE", null)));
  }
  return findings;
}
