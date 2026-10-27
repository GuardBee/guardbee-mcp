import * as tls from "tls";
import { X509Certificate } from "crypto";
import { promises as dns } from "dns";
import { cipherBits, probeHost, weakSignature, type ProbeResult } from "./probes.js";

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
  /** Leaf public key, e.g. "rsa" 2048 or "ec" prime256v1 (256). */
  keyType?: string;
  keyBits?: number;
  /** A weak hash in the leaf's or an intermediate's signature (SHA-1, MD5). */
  weakSignature?: string;
  /** The server stapled an OCSP response. */
  ocspStapled?: boolean;
  /** What the server accepts beyond the default handshake (see probes.ts). */
  probes?: ProbeResult;
  /** CAA records restricting which CAs may issue for the domain. */
  caa?: string[];

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

/** Chain errors from OpenSSL, told apart: each needs a different fix. */
function chainFinding(error: string): Finding {
  if (/SELF_SIGNED/.test(error)) {
    return { severity: "high", code: "CERT_SELF_SIGNED", message: `Self-signed certificate (${error}): browsers and clients will not trust it` };
  }
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/.test(error)) {
    return { severity: "high", code: "CERT_CHAIN_INCOMPLETE", message: `Incomplete chain (${error}): the server does not send its intermediate certificate` };
  }
  if (/CERT_REVOKED/.test(error)) return { severity: "critical", code: "CERT_REVOKED", message: "The certificate has been revoked" };
  return { severity: "high", code: "CERT_CHAIN_INVALID", message: `Certificate chain invalid: ${error}` };
}

/** CAA records for the domain or its nearest parent that has them. */
async function lookupCaa(host: string): Promise<string[] | undefined> {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    try {
      const records = await dns.resolveCaa(labels.slice(i).join("."));
      if (records.length > 0) return records.map((r) => `${r.critical ? "!" : ""}${Object.entries(r).filter(([k]) => k !== "critical").map(([k, v]) => `${k} ${v}`).join(" ")}`);
    } catch {
      // NODATA / NXDOMAIN: try the parent
    }
  }
  return undefined;
}

// ── Main inspect function ─────────────────────────────────────────────────────

export async function inspectHost(
  host: string,
  port: number = 443,
  timeoutMs: number = 10_000,
  options: {
    /** Extra handshakes for legacy protocols, static RSA, DH size and weak ciphers (default true). */
    probes?: boolean;
    /** DNS CAA lookup (default true). */
    caa?: boolean;
  } = {},
): Promise<TlsInspectResult> {
  const result: TlsInspectResult = { host, port, reachable: false, findings: [] };

  return new Promise((resolve) => {
    let ocspStapled = false;
    const timer = setTimeout(() => {
      socket.destroy();
      result.error = `Connection timed out after ${timeoutMs}ms`;
      result.findings.push({ severity: "high", code: "TIMEOUT", message: result.error });
      resolve(result);
    }, timeoutMs);

    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: timeoutMs,
        // A server that only speaks TLS 1.0 must still be inspected, not reported unreachable
        minVersion: "TLSv1",
        ciphers: "DEFAULT:@SECLEVEL=0",
        requestOCSP: true,
      },
      () => {
        clearTimeout(timer);
        result.reachable = true;

        const proto = socket.getProtocol() ?? "unknown";
        result.protocol = proto;

        const cipher = socket.getCipher();
        result.cipher = cipher?.name;
        result.cipherStrength = cipher?.name ? cipherBits(cipher.name) : undefined;

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
          } else if (days < 21) {
            // Let's Encrypt and most ACME clients renew with 30 days left: under 21, renewal is failing
            result.findings.push({ severity: "high", code: "CERT_EXPIRY_SOON", message: `Certificate expires in ${days} days (automatic renewal may be failing)` });
          } else if (days < 30) {
            result.findings.push({ severity: "medium", code: "CERT_EXPIRY_WARN", message: `Certificate expires in ${days} days` });
          }

          // The leaf's expiry is reported above; an expired chain says the same thing again
          const chainError = String(socket.authorizationError ?? "");
          if (!socket.authorized && !(certInfo.isExpired && chainError === "CERT_HAS_EXPIRED")) {
            result.findings.push(chainFinding(chainError || "unknown"));
          }

          // rejectUnauthorized is off, so the name is checked here
          const identity = tls.checkServerIdentity(host, peerCert);
          if (identity) {
            result.findings.push({ severity: "critical", code: "HOSTNAME_MISMATCH", message: `The certificate is not valid for ${host}: ${identity.message}` });
          }

          // Key strength
          try {
            const x509 = new X509Certificate(peerCert.raw);
            const key = x509.publicKey;
            const details = key.asymmetricKeyDetails ?? {};
            result.keyType = key.asymmetricKeyType;
            if (key.asymmetricKeyType === "rsa" && details.modulusLength) {
              result.keyBits = details.modulusLength;
              if (details.modulusLength < 1024) {
                result.findings.push({ severity: "critical", code: "WEAK_KEY", message: `RSA key is ${details.modulusLength} bits` });
              } else if (details.modulusLength < 2048) {
                result.findings.push({ severity: "high", code: "WEAK_KEY", message: `RSA key is ${details.modulusLength} bits (use 2048 or more)` });
              }
            } else if (key.asymmetricKeyType === "ec" && details.namedCurve) {
              const bits = Number(/(\d{3})/.exec(details.namedCurve)?.[1] ?? 256);
              result.keyBits = bits;
              if (bits < 256) result.findings.push({ severity: "high", code: "WEAK_KEY", message: `EC key on ${details.namedCurve} is under 256 bits` });
            }
          } catch {
            // An unusual key type: nothing to judge
          }

          // Weak hash in the leaf's or an intermediate's signature (a root's own signature does not matter)
          for (let c: tls.DetailedPeerCertificate | undefined = peerCert, i = 0; c && i < 10; c = c.issuerCertificate, i++) {
            if (c.issuerCertificate === c) break;
            const weak = c.raw ? weakSignature(c.raw) : null;
            if (weak) {
              result.weakSignature = weak;
              result.findings.push({ severity: "high", code: "WEAK_SIGNATURE", message: `${i === 0 ? "The certificate" : "An intermediate certificate"} is signed with ${weak}` });
              break;
            }
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

        socket.end();
        void finish();
      }
    );

    socket.on("OCSPResponse", (response: Buffer) => {
      ocspStapled = Boolean(response && response.length > 0);
    });

    /** Checks that need more connections or DNS, after the main handshake. */
    const finish = async () => {
      result.ocspStapled = ocspStapled;
      // Only meaningful for a publicly trusted certificate
      if (!ocspStapled && result.chainValid) {
        result.findings.push({ severity: "low", code: "NO_OCSP_STAPLING", message: "The server does not staple an OCSP response (clients must ask the CA themselves)" });
      }

      if (options.probes !== false) {
        const probes = await probeHost(host, port, timeoutMs);
        result.probes = probes;
        // The main handshake landing on TLS 1.0/1.1 already produced this finding
        const legacy = [probes.tls10 && "TLS 1.0", probes.tls11 && "TLS 1.1"].filter((v): v is string => Boolean(v));
        if (legacy.length > 0 && !result.findings.some((f) => f.code === "DEPRECATED_PROTOCOL")) {
          result.findings.push({ severity: "high", code: "DEPRECATED_PROTOCOL", message: `The server still accepts ${legacy.join(" and ")}; allow TLS 1.2 and 1.3 only` });
        }
        if (probes.tls13 === false) {
          result.findings.push({ severity: "low", code: "NO_TLS13", message: "The server does not support TLS 1.3" });
        }
        if (probes.staticRsa) {
          result.findings.push({ severity: "medium", code: "NO_FORWARD_SECRECY", message: "The server accepts RSA key exchange ciphers: recorded traffic can be decrypted later if the key leaks" });
        }
        if (probes.dhBits !== undefined && probes.dhBits < 2048) {
          result.findings.push({ severity: probes.dhBits < 1024 ? "critical" : "high", code: "WEAK_DH", message: `The server's Diffie-Hellman group is ${probes.dhBits} bits (use 2048 or more, or ECDHE)` });
        }
        for (const family of probes.weakCiphers) {
          result.findings.push({ severity: family === "3DES" ? "high" : "critical", code: "WEAK_CIPHER", message: `The server accepts ${family} cipher suites` });
        }
      }

      if (options.caa !== false && !/^[\d.]+$|:/.test(host)) {
        result.caa = await lookupCaa(host);
        if (!result.caa) {
          result.findings.push({ severity: "low", code: "NO_CAA", message: "No CAA DNS record: any certificate authority may issue certificates for this domain" });
        }
      }

      if (result.findings.length === 0) {
        result.findings.push({ severity: "info", code: "OK", message: "No issues found" });
      }
      resolve(result);
    };

    socket.on("error", (err: Error) => {
      clearTimeout(timer);
      result.error = err.message;
      // A handshake failure here, with every protocol and cipher this runtime has on offer,
      // usually means the server only speaks something it cannot (RC4, 3DES, SSLv3)
      const hint = /handshake failure|no shared cipher|unsupported protocol|wrong version number/i.test(err.message)
        ? " — the server may only offer protocols or ciphers this runtime cannot use (SSLv3, RC4, 3DES), which would itself be critical; check with testssl.sh"
        : "";
      result.findings.push({ severity: "high", code: "CONNECTION_ERROR", message: `${err.message}${hint}` });
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
    if (r.keyType) lines.push(`│  Key       : ${r.keyType.toUpperCase()} ${r.keyBits ?? "?"} bit${r.weakSignature ? ` · signed with ${r.weakSignature}` : ""}`);
    if (r.probes) {
      const accepted = [r.probes.tls10 && "TLS 1.0", r.probes.tls11 && "TLS 1.1", "TLS 1.2", r.probes.tls13 && "TLS 1.3"].filter(Boolean).join(", ");
      lines.push(`│  Accepts   : ${accepted}${r.probes.staticRsa ? " · RSA key exchange" : ""}${r.probes.dhBits ? ` · DH ${r.probes.dhBits} bit` : ""}`);
      if (r.probes.notTested.length > 0) lines.push(`│  Not tested: ${r.probes.notTested.join(", ")} (not in this runtime's OpenSSL)`);
    }
    if (r.ocspStapled !== undefined) lines.push(`│  OCSP      : ${r.ocspStapled ? "stapled" : "not stapled"}`);
    if (r.caa) lines.push(`│  CAA       : ${r.caa.join("; ")}`);

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
