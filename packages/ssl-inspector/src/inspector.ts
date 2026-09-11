import * as tls from "tls";
import * as net from "net";

export interface CertInfo {
  subject: Record<string, string>;
  issuer: Record<string, string>;
  validFrom: string;
  validTo: string;
  daysUntilExpiry: number;
  isExpired: boolean;
  serialNumber: string;
  fingerprint: string;
  fingerprint256: string;
  subjectAltNames: string[];
  keyUsage: string[];
  extKeyUsage: string[];
  isCA: boolean;
}

export interface TlsInspectResult {
  host: string;
  port: number;
  reachable: boolean;
  error?: string;

  // Protocol
  protocol?: string; // e.g. "TLSv1.3"
  cipher?: string;
  cipherStrength?: number;

  // Certificate chain
  cert?: CertInfo;
  chainDepth?: number;
  chainValid?: boolean;

  // Security flags
  supportsHsts?: boolean;
  hstsMaxAge?: number;
  hstsIncludesSubdomains?: boolean;

  // Findings
  findings: Finding[];
}

export interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  code: string;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDN(dn: string | Record<string, string>): Record<string, string> {
  if (typeof dn === "object") return dn;
  const result: Record<string, string> = {};
  for (const part of dn.split(",")) {
    const [k, ...v] = part.trim().split("=");
    if (k && v.length > 0) result[k.trim()] = v.join("=").trim();
  }
  return result;
}

function extractSANs(cert: tls.PeerCertificate): string[] {
  const raw = (cert as unknown as Record<string, unknown>).subjectaltname as string | undefined;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/^DNS:|^IP Address:/, ""))
    .filter(Boolean);
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.floor((target - now) / (1000 * 60 * 60 * 24));
}

function cipherStrength(cipherName: string): number {
  const m = cipherName.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 128;
}

// ── Main inspect function ─────────────────────────────────────────────────────

export async function inspectHost(
  host: string,
  port: number = 443,
  timeoutMs: number = 10_000
): Promise<TlsInspectResult> {
  const result: TlsInspectResult = { host, port, reachable: false, findings: [] };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy();
      result.error = `Connection timed out after ${timeoutMs}ms`;
      result.findings.push({ severity: "high", code: "TIMEOUT", message: result.error });
      resolve(result);
    }, timeoutMs);

    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        clearTimeout(timer);
        result.reachable = true;

        const proto = socket.getProtocol() ?? "unknown";
        result.protocol = proto;

        const cipher = socket.getCipher();
        result.cipher = cipher?.name;
        result.cipherStrength = cipher?.name ? cipherStrength(cipher.name) : undefined;

        const peerCert = socket.getPeerCertificate(true);

        if (peerCert && Object.keys(peerCert).length > 0) {
          const days = daysUntil(peerCert.valid_to);
          const certInfo: CertInfo = {
            subject: parseDN(peerCert.subject as unknown as string),
            issuer: parseDN(peerCert.issuer as unknown as string),
            validFrom: peerCert.valid_from,
            validTo: peerCert.valid_to,
            daysUntilExpiry: days,
            isExpired: days < 0,
            serialNumber: peerCert.serialNumber ?? "",
            fingerprint: peerCert.fingerprint ?? "",
            fingerprint256: peerCert.fingerprint256 ?? "",
            subjectAltNames: extractSANs(peerCert),
            keyUsage: [],
            extKeyUsage: [],
            isCA: false,
          };
          result.cert = certInfo;

          // Walk chain depth
          let depth = 0;
          let cur = peerCert as tls.DetailedPeerCertificate | null;
          while (cur?.issuerCertificate && cur.issuerCertificate !== cur) {
            depth++;
            cur = cur.issuerCertificate as tls.DetailedPeerCertificate;
            if (depth > 10) break;
          }
          result.chainDepth = depth;
          result.chainValid = socket.authorized;

          // ── Certificate findings ──
          if (certInfo.isExpired) {
            result.findings.push({ severity: "critical", code: "CERT_EXPIRED", message: `Certificate expired ${Math.abs(days)} days ago` });
          } else if (days < 7) {
            result.findings.push({ severity: "critical", code: "CERT_EXPIRY_CRITICAL", message: `Certificate expires in ${days} days` });
          } else if (days < 30) {
            result.findings.push({ severity: "high", code: "CERT_EXPIRY_SOON", message: `Certificate expires in ${days} days` });
          } else if (days < 90) {
            result.findings.push({ severity: "medium", code: "CERT_EXPIRY_WARN", message: `Certificate expires in ${days} days` });
          }

          if (!socket.authorized) {
            result.findings.push({ severity: "high", code: "CERT_CHAIN_INVALID", message: `Certificate chain invalid: ${socket.authorizationError ?? "unknown"}` });
          }

          if (certInfo.subjectAltNames.length === 0) {
            result.findings.push({ severity: "medium", code: "CERT_NO_SAN", message: "Certificate has no Subject Alternative Names" });
          }
        }

        // ── Protocol findings ──
        if (proto === "TLSv1" || proto === "TLSv1.1") {
          result.findings.push({ severity: "high", code: "DEPRECATED_PROTOCOL", message: `${proto} is deprecated and insecure; upgrade to TLS 1.2+` });
        } else if (proto === "SSLv2" || proto === "SSLv3") {
          result.findings.push({ severity: "critical", code: "OBSOLETE_PROTOCOL", message: `${proto} is critically vulnerable; disable immediately` });
        }

        // ── Cipher findings ──
        const cn = cipher?.name ?? "";
        if (/NULL|EXPORT|anon|RC4|DES(?!-EDE)|MD5/i.test(cn)) {
          result.findings.push({ severity: "critical", code: "WEAK_CIPHER", message: `Insecure cipher suite in use: ${cn}` });
        } else if (/3DES|RC2|IDEA/i.test(cn)) {
          result.findings.push({ severity: "high", code: "WEAK_CIPHER", message: `Weak cipher suite in use: ${cn}` });
        } else if ((result.cipherStrength ?? 256) < 128) {
          result.findings.push({ severity: "high", code: "WEAK_CIPHER_STRENGTH", message: `Cipher key length too short: ${result.cipherStrength} bits` });
        }

        if (result.findings.length === 0) {
          result.findings.push({ severity: "info", code: "OK", message: "No issues found" });
        }

        socket.end();
        resolve(result);
      }
    );

    socket.on("error", (err: Error) => {
      clearTimeout(timer);
      result.error = err.message;
      result.findings.push({ severity: "high", code: "CONNECTION_ERROR", message: err.message });
      resolve(result);
    });

    socket.on("timeout", () => {
      clearTimeout(timer);
      socket.destroy();
      result.error = "Socket timeout";
      result.findings.push({ severity: "high", code: "TIMEOUT", message: "Socket timeout" });
      resolve(result);
    });
  });
}

// ── HSTS check via HTTP HEAD ──────────────────────────────────────────────────

export async function checkHsts(host: string, port: number = 443): Promise<{ enabled: boolean; maxAge?: number; includesSubdomains?: boolean }> {
  try {
    const res = await fetch(`https://${host}:${port}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    const header = res.headers.get("strict-transport-security");
    if (!header) return { enabled: false };

    const maxAgeMatch = header.match(/max-age=(\d+)/i);
    const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]!, 10) : 0;
    const includesSubdomains = /includeSubDomains/i.test(header);

    return { enabled: true, maxAge, includesSubdomains };
  } catch {
    return { enabled: false };
  }
}

// ── Report formatter ──────────────────────────────────────────────────────────

export function formatInspectReport(results: TlsInspectResult[]): string {
  const lines: string[] = [];

  for (const r of results) {
    lines.push(`┌─ ${r.host}:${r.port}`);

    if (!r.reachable) {
      lines.push(`│  ✗ Unreachable: ${r.error ?? "unknown"}`);
      lines.push("│");
      continue;
    }

    lines.push(`│  Protocol  : ${r.protocol ?? "unknown"}`);
    lines.push(`│  Cipher    : ${r.cipher ?? "unknown"} (${r.cipherStrength ?? "?"} bit)`);
    lines.push(`│  Chain     : depth=${r.chainDepth ?? "?"} valid=${r.chainValid ? "yes" : "no"}`);

    if (r.cert) {
      const c = r.cert;
      const cn = c.subject["CN"] ?? c.subjectAltNames[0] ?? "?";
      const status = c.isExpired ? "EXPIRED" : `expires in ${c.daysUntilExpiry} days`;
      lines.push(`│  Cert CN   : ${cn}`);
      lines.push(`│  Validity  : ${c.validFrom} → ${c.validTo} (${status})`);
      lines.push(`│  SANs      : ${c.subjectAltNames.slice(0, 5).join(", ") || "none"}`);
      lines.push(`│  Issuer    : ${c.issuer["O"] ?? c.issuer["CN"] ?? "unknown"}`);
      lines.push(`│  SHA-256   : ${c.fingerprint256}`);
    }

    if (r.supportsHsts !== undefined) {
      const hstsStr = r.supportsHsts
        ? `enabled (max-age=${r.hstsMaxAge}${r.hstsIncludesSubdomains ? ", includeSubdomains" : ""})`
        : "not set";
      lines.push(`│  HSTS      : ${hstsStr}`);
    }

    const issues = r.findings.filter((f) => f.code !== "OK");
    if (issues.length === 0) {
      lines.push("│  ✅ No security issues found");
    } else {
      lines.push(`│  ⚠️  ${issues.length} issue(s) found:`);
      for (const f of issues) {
        lines.push(`│    [${f.severity.toUpperCase()}] ${f.message}`);
      }
    }

    lines.push("│");
  }

  return lines.join("\n");
}
