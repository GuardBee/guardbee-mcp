import * as tls from "tls";
import * as dns from "dns/promises";
import type { Finding } from "./dns.js";

export interface CaaRecord {
  critical: number;
  issue?: string;
  issuewild?: string;
  iodef?: string;
  [tag: string]: unknown;
}

export type CaaResolver = (name: string) => Promise<CaaRecord[]>;

export interface CaaCheck {
  /** Owner name of the CAA set in force (the domain or the nearest parent), if any. */
  at?: string;
  issue: string[];
  issuewild: string[];
  iodef: string[];
  /** Issuer organisation of the certificate served on :443, when fetched. */
  currentIssuer?: string;
  findings: Finding[];
}

/** CA organisation (as in certificate issuer O=) → identifiers CAs check in CAA. */
export const CA_IDENTIFIERS: Array<[RegExp, string[]]> = [
  [/^Let's Encrypt$/i, ["letsencrypt.org"]],
  [/^Google Trust Services/i, ["pki.goog"]],
  [/^DigiCert/i, ["digicert.com", "symantec.com", "geotrust.com", "rapidssl.com", "thawte.com"]],
  [/^Sectigo|^COMODO/i, ["sectigo.com", "comodoca.com", "comodo.com"]],
  [/^ZeroSSL/i, ["sectigo.com", "zerossl.com"]],
  [/^GlobalSign/i, ["globalsign.com"]],
  [/^Amazon/i, ["amazon.com", "amazontrust.com", "awstrust.com", "amazonaws.com"]],
  [/^Microsoft/i, ["microsoft.com"]],
  [/^SSL Corporation|^SSL\.com/i, ["ssl.com"]],
  [/^Entrust/i, ["entrust.net"]],
];

/** "letsencrypt.org; validationmethods=dns-01" → "letsencrypt.org"; ";" → "" (no CA). */
function issuerDomain(value: string): string {
  return value.split(";")[0]!.trim().toLowerCase();
}

/** RFC 8659 §3: the relevant CAA set is the domain's own, or the closest ancestor's. */
export async function findCaa(domain: string, resolve: CaaResolver): Promise<{ at?: string; records: CaaRecord[] }> {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    try {
      const records = await resolve(name);
      if (records.length > 0) return { at: name, records };
    } catch {
      // ENODATA / ENOTFOUND: climb
    }
  }
  return { records: [] };
}

/** Issuer organisation of the certificate a host serves, or undefined. */
export function fetchIssuer(host: string, timeoutMs = 8000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: timeoutMs }, () => {
      const issuer = socket.getPeerCertificate()?.issuer?.O;
      socket.end();
      resolve(Array.isArray(issuer) ? issuer[0] : issuer);
    });
    socket.on("error", () => resolve(undefined));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}

export async function checkCaa(
  domain: string,
  opts: { resolveCaa?: CaaResolver; issuer?: (host: string) => Promise<string | undefined> } = {}
): Promise<CaaCheck> {
  const { at, records } = await findCaa(domain, opts.resolveCaa ?? ((n) => dns.resolveCaa(n) as Promise<CaaRecord[]>));
  const out: CaaCheck = {
    ...(at ? { at } : {}),
    issue: records.filter((r) => typeof r.issue === "string").map((r) => issuerDomain(r.issue!)),
    issuewild: records.filter((r) => typeof r.issuewild === "string").map((r) => issuerDomain(r.issuewild!)),
    iodef: records.filter((r) => typeof r.iodef === "string").map((r) => r.iodef!),
    findings: [],
  };

  if (!at) {
    out.findings.push({
      severity: "low",
      code: "CAA_MISSING",
      message: `No CAA record for ${domain}: any certificate authority may issue certificates for it. Publish CAA for the CA(s) you use`,
    });
    return out;
  }

  const known = new Set(["issue", "issuewild", "iodef", "critical", "issuemail", "issuevmc", "contactemail", "contactphone"]);
  const unknownCritical = records.filter((r) => (r.critical & 128) !== 0 && Object.keys(r).some((k) => !known.has(k)));
  if (unknownCritical.length > 0) {
    out.findings.push({
      severity: "high",
      code: "CAA_UNKNOWN_CRITICAL",
      message: `CAA at ${at} has a critical record with a tag CAs do not understand; every CA must refuse to issue`,
    });
  }

  // Does the CA that issued the live certificate still pass CAA? If not, its next renewal fails.
  const issuer = await (opts.issuer ?? fetchIssuer)(domain);
  if (issuer) {
    out.currentIssuer = issuer;
    const ids = CA_IDENTIFIERS.find(([re]) => re.test(issuer))?.[1];
    // Only `issue` governs a non-wildcard certificate; with no `issue` tag any CA may issue it.
    if (ids && out.issue.length > 0 && !ids.some((id) => out.issue.includes(id))) {
      out.findings.push({
        severity: "medium",
        code: "CAA_BLOCKS_CURRENT_CA",
        message: `The certificate on ${domain} is from ${issuer}, but CAA at ${at} only allows ${out.issue.filter(Boolean).join(", ") || "no CA"}; renewing it will fail`,
      });
    }
  }
  return out;
}
