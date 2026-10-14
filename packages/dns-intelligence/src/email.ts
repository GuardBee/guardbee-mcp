import { createPublicKey } from "crypto";
import type { Finding } from "./dns.js";
import { lookup, valueOf, type DnsResolver } from "./resolver.js";

// ── DKIM ──────────────────────────────────────────────────────────────────────

/**
 * Selectors used by common senders. DKIM selectors cannot be listed from DNS,
 * so a missing key here only means "not found among these".
 */
export const DKIM_SELECTORS = [
  "default", "dkim", "mail", "smtp", "mx", "k1", "k2", "k3", "s1", "s2",
  "google", "selector1", "selector2", "resend", "mandrill", "mailjet", "mxvault",
  "zoho", "zmail", "protonmail", "protonmail2", "protonmail3", "fm1", "fm2", "fm3",
  "pm", "sig1", "everlytickey1", "everlytickey2", "cm", "ses",
  // Google Workspace / Gmail date-stamped selectors
  "20230601", "20221208", "20210112", "20161025",
];

export interface DkimKeyInfo {
  selector: string;
  /** "rsa" | "ed25519" | other k= value */
  keyType: string;
  /** RSA modulus size; undefined for Ed25519 or an unreadable key. */
  bits?: number;
  revoked: boolean;
  testing: boolean;
  issues: Finding[];
}

function tags(record: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of record.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).replace(/\s+/g, "").trim();
  }
  return out;
}

/** Read a DKIM key record: key type, RSA size, revocation and test flags. */
export function analyzeDkimRecord(selector: string, record: string): DkimKeyInfo {
  const t = tags(record);
  const keyType = (t["k"] ?? "rsa").toLowerCase();
  const p = t["p"] ?? "";
  const testing = (t["t"] ?? "").split(":").includes("y");
  const info: DkimKeyInfo = { selector, keyType, revoked: p === "", testing, issues: [] };

  if (info.revoked) {
    info.issues.push({ severity: "info", code: "DKIM_KEY_REVOKED", message: `DKIM selector '${selector}' is revoked (empty p=)` });
    return info;
  }
  if (keyType === "rsa") {
    try {
      const key = createPublicKey({ key: Buffer.from(p, "base64"), format: "der", type: "spki" });
      info.bits = key.asymmetricKeyDetails?.modulusLength;
    } catch {
      info.issues.push({ severity: "medium", code: "DKIM_KEY_INVALID", message: `DKIM selector '${selector}' publishes a key that cannot be parsed; signatures with it fail` });
      return info;
    }
    if (info.bits !== undefined && info.bits < 1024) {
      info.issues.push({ severity: "high", code: "DKIM_KEY_WEAK", message: `DKIM selector '${selector}' uses a ${info.bits}-bit RSA key; keys under 1024 bits can be factored and are rejected by receivers` });
    } else if (info.bits !== undefined && info.bits < 2048) {
      info.issues.push({ severity: "medium", code: "DKIM_KEY_1024", message: `DKIM selector '${selector}' uses a ${info.bits}-bit RSA key; rotate to 2048 bits (RFC 8301 recommends at least 2048)` });
    }
  }
  if (testing) {
    info.issues.push({ severity: "low", code: "DKIM_TESTING", message: `DKIM selector '${selector}' is in test mode (t=y); receivers may ignore failures` });
  }
  return info;
}

export async function checkDkim(
  domain: string,
  r: DnsResolver,
  selectors: string[] = DKIM_SELECTORS
): Promise<{ found: Record<string, boolean>; keys: DkimKeyInfo[] }> {
  const found: Record<string, boolean> = {};
  const keys: DkimKeyInfo[] = [];
  await Promise.all(
    [...new Set(selectors)].map(async (sel) => {
      const txt = valueOf(await lookup(() => r.resolveTxt(`${sel}._domainkey.${domain}`)));
      const record = txt?.map((c) => c.join("")).find((v) => /(^|;)\s*(v=DKIM1|p=)/i.test(v));
      found[sel] = !!record;
      if (record) keys.push(analyzeDkimRecord(sel, record));
    })
  );
  keys.sort((a, b) => a.selector.localeCompare(b.selector));
  return { found, keys };
}

// ── SPF suggestion ────────────────────────────────────────────────────────────

/** SPF include for mailbox providers recognisable from MX hosts (their documented values). */
const MX_SPF_INCLUDES: Array<[RegExp, string]> = [
  [/(^|\.)(google\.com|googlemail\.com)$/, "include:_spf.google.com"],
  [/\.mail\.protection\.outlook\.com$/, "include:spf.protection.outlook.com"],
];

/**
 * A starting SPF record: includes for recognised mailbox providers, or
 * "v=spf1 -all" for a domain that receives no mail. Other senders (newsletters,
 * transactional mail) must still be added by the owner.
 */
export function suggestSpf(mxHosts: string[]): string {
  if (mxHosts.length === 0) return "v=spf1 -all";
  const includes = [...new Set(mxHosts.flatMap((h) => MX_SPF_INCLUDES.filter(([re]) => re.test(h)).map(([, inc]) => inc)))];
  return includes.length ? `v=spf1 ${includes.join(" ")} ~all` : "v=spf1 include:<your-mail-provider> ~all";
}

// ── MX ────────────────────────────────────────────────────────────────────────

export interface MxCheck {
  hosts: string[];
  /** "0 ." — the domain declares it accepts no mail (RFC 7505). */
  nullMx: boolean;
  findings: Finding[];
}

export async function checkMx(mx: Array<{ priority: number; exchange: string }>, r: DnsResolver): Promise<MxCheck> {
  const hosts = mx.map((m) => m.exchange.toLowerCase().replace(/\.$/, ""));
  if (hosts.length === 1 && hosts[0] === "") {
    return { hosts: [], nullMx: true, findings: [{ severity: "info", code: "NULL_MX", message: "Null MX (0 .): the domain accepts no mail" }] };
  }
  const findings: Finding[] = [];
  await Promise.all(
    hosts.map(async (h) => {
      const [a, aaaa] = await Promise.all([lookup(() => r.resolve4(h, { ttl: true })), lookup(() => r.resolve6(h, { ttl: true }))]);
      if (a.status !== "ok" && aaaa.status !== "ok" && a.status !== "error" && aaaa.status !== "error") {
        findings.push({ severity: "high", code: "MX_UNRESOLVABLE", message: `MX host ${h} has no A/AAAA record; mail sent to it bounces` });
      }
    })
  );
  return { hosts, nullMx: false, findings };
}

// ── MTA-STS (RFC 8461) ────────────────────────────────────────────────────────

export interface MtaStsPolicy {
  version?: string;
  mode?: string;
  mx: string[];
  maxAge?: number;
}

export function parseMtaStsPolicy(text: string): MtaStsPolicy {
  const policy: MtaStsPolicy = { mx: [] };
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "version") policy.version = value;
    else if (key === "mode") policy.mode = value.toLowerCase();
    else if (key === "mx") policy.mx.push(value.toLowerCase().replace(/\.$/, ""));
    else if (key === "max_age") policy.maxAge = Number(value);
  }
  return policy;
}

/** RFC 8461 §4.1: "*.example.com" matches exactly one extra leftmost label. */
export function mxMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && !host.slice(0, -suffix.length).includes(".") && host.length > suffix.length;
  }
  return pattern === host;
}

export interface MtaStsCheck {
  /** The _mta-sts TXT record, when one exists. */
  record?: string;
  policy?: MtaStsPolicy;
  findings: Finding[];
}

export async function checkMtaSts(
  domain: string,
  mxHosts: string[],
  r: DnsResolver,
  options: { http?: boolean; fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<MtaStsCheck> {
  const findings: Finding[] = [];
  const txt = valueOf(await lookup(() => r.resolveTxt(`_mta-sts.${domain}`))) ?? [];
  const records = txt.map((c) => c.join("")).filter((v) => /^v=STSv1\s*(;|$)/i.test(v));

  if (records.length === 0) {
    if (mxHosts.length > 0) {
      findings.push({ severity: "low", code: "MTA_STS_MISSING", message: "No MTA-STS policy: senders deliver over TLS only if available, so an attacker on the path can downgrade inbound mail to plaintext" });
    }
    return { findings };
  }
  if (records.length > 1) {
    findings.push({ severity: "medium", code: "MTA_STS_MULTIPLE", message: `_mta-sts.${domain} has ${records.length} STSv1 records; senders ignore MTA-STS` });
    return { findings };
  }
  const record = records[0]!;
  if (!tags(record)["id"]) {
    findings.push({ severity: "medium", code: "MTA_STS_NO_ID", message: "MTA-STS record has no id= tag; senders ignore it" });
  }
  if (options.http === false) return { record, findings };

  const url = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
  let text: string;
  try {
    // RFC 8461 §3.3: the policy must be served directly over HTTPS, without redirects.
    const res = await (options.fetch ?? fetch)(url, { redirect: "manual", signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    const reason = err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : String(err);
    findings.push({ severity: "medium", code: "MTA_STS_POLICY_UNREACHABLE", message: `MTA-STS is announced but ${url} is unusable (${reason}); senders treat the domain as having no policy` });
    return { record, findings };
  }

  const policy = parseMtaStsPolicy(text);
  if (policy.version !== "STSv1" || !["enforce", "testing", "none"].includes(policy.mode ?? "") || policy.maxAge === undefined || !Number.isFinite(policy.maxAge)) {
    findings.push({ severity: "medium", code: "MTA_STS_POLICY_INVALID", message: "MTA-STS policy file is missing version: STSv1, a valid mode or max_age; senders ignore it" });
    return { record, policy, findings };
  }
  if (policy.mode === "testing") {
    findings.push({ severity: "low", code: "MTA_STS_TESTING", message: "MTA-STS is in testing mode: failures are reported, not enforced" });
  } else if (policy.mode === "none") {
    findings.push({ severity: "low", code: "MTA_STS_MODE_NONE", message: "MTA-STS mode is none: the policy is withdrawn" });
  }
  const unmatched = mxHosts.filter((h) => !policy.mx.some((p) => mxMatches(p, h)));
  if (unmatched.length > 0 && policy.mode !== "none") {
    findings.push({
      severity: policy.mode === "enforce" ? "high" : "medium",
      code: "MTA_STS_MX_MISMATCH",
      message: `MTA-STS policy does not list MX host(s) ${unmatched.join(", ")}${policy.mode === "enforce" ? "; senders that honour MTA-STS will refuse to deliver to them" : ""}`,
    });
  }
  if (policy.maxAge < 86_400) {
    findings.push({ severity: "low", code: "MTA_STS_MAX_AGE_SHORT", message: `MTA-STS max_age is ${policy.maxAge}s; under a day weakens protection between refreshes` });
  }
  return { record, policy, findings };
}

// ── TLS-RPT (RFC 8460) ────────────────────────────────────────────────────────

export async function checkTlsRpt(domain: string, r: DnsResolver, mtaStsInUse: boolean): Promise<{ record?: string; findings: Finding[] }> {
  const txt = valueOf(await lookup(() => r.resolveTxt(`_smtp._tls.${domain}`))) ?? [];
  const records = txt.map((c) => c.join("")).filter((v) => /^v=TLSRPTv1\s*(;|$)/i.test(v));
  if (records.length === 0) {
    return mtaStsInUse
      ? { findings: [{ severity: "low", code: "TLSRPT_MISSING", message: "MTA-STS is set up without TLS-RPT (_smtp._tls); you will not hear about TLS delivery failures" }] }
      : { findings: [] };
  }
  if (records.length > 1) {
    return { findings: [{ severity: "low", code: "TLSRPT_MULTIPLE", message: `_smtp._tls.${domain} has ${records.length} TLS-RPT records; reporters ignore them` }] };
  }
  const rua = tags(records[0]!)["rua"] ?? "";
  const valid = rua.split(",").some((u) => /^(mailto:|https:)/i.test(u.trim()));
  return {
    record: records[0]!,
    findings: valid ? [] : [{ severity: "low", code: "TLSRPT_INVALID", message: "TLS-RPT record has no mailto: or https: rua; no reports are sent" }],
  };
}
