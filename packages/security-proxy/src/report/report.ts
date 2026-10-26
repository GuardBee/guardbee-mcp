import { createHash, createPrivateKey, createPublicKey, sign, verify } from "crypto";
import {
  CAPABILITY_TITLES,
  COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_MAPPING_VERSION,
  THREAT_CATEGORIES,
  classifyEvent,
  type ComplianceCapability,
  type ComplianceFrameworkId,
  type FrameworkRef,
  type ThreatCategoryKey,
} from "@guardbee/guard-core";
import { verifyAuditChain } from "../audit/logger.js";
import { stable } from "../interceptors/definition-drift.js";
import type { AuditEvent } from "../types.js";

/**
 * A periodic security report from the audit log: what the gateway saw and
 * refused, mapped to OWASP Top 10 for LLM Applications and MITRE ATLAS. The
 * report is tied to the audit hash chain (its last hash in the period) and
 * carries a SHA-256 digest, optionally signed with an Ed25519 key, so a
 * reader can check that nobody edited it.
 */

export interface ReportCategory {
  id: string;
  title: string;
  owasp: FrameworkRef[];
  atlas: FrameworkRef[];
  events: number;
  blocked: number;
  /** Up to five distinct reasons, as logged (payloads are never in the report). */
  examples: string[];
}

export interface SecurityReport {
  schema: "guardbee.security-report/1";
  generatedAt: string;
  period: { from: string; to: string };
  source: { file: string; events: number; chain: { ok: boolean; detail: string }; lastHash: string | null };
  totals: { events: number; toolCalls: number; blocked: number; warnings: number; toxicFlows: number; approvals: number; sessions: number; users: number };
  categories: ReportCategory[];
  personalData: Record<string, number>;
  topRules: { ruleId: string; count: number }[];
  topTools: { tool: string; blocked: number }[];
  /** With `--framework`: the period's findings and the gateway's controls as evidence for that framework's requirements. */
  compliance?: ComplianceSection;
}

export interface ComplianceSection {
  framework: { id: ComplianceFrameworkId; name: string; edition: string; mappingVersion: string };
  /** Every control the mapping covers, with what this period shows for it. */
  controls: {
    id: string;
    name: string;
    citation: string;
    /** Findings in threat categories mapped to this control. */
    findings: number;
    blocked: number;
    categories: string[];
    /** Gateway capabilities seen at work in this period that support the control. */
    capabilities: string[];
  }[];
  disclaimer: string;
}

/** Which gateway capabilities the period's events show at work. */
function capabilitiesSeen(events: AuditEvent[], chainOk: boolean): Set<ComplianceCapability> {
  const seen = new Set<ComplianceCapability>();
  if (chainOk && events.length > 0) seen.add("auditLog");
  for (const event of events) {
    const rule = event.ruleId ?? "";
    if (event.type === "approval") seen.add("humanApproval");
    if (event.user || /^quota:|^llm:access/.test(rule)) seen.add("accessControl");
    if (/^(?:pin:|provenance:|poisoning:|sandbox:)/.test(rule) || /rug pull|definition (?:changed|drift)/i.test(event.reason ?? "")) seen.add("supplyChain");
    if (event.piiHits && Object.keys(event.piiHits).length > 0) seen.add("dataMasking");
    if (classifyEvent(event)) seen.add("monitoring");
  }
  return seen;
}

function complianceSection(
  id: ComplianceFrameworkId,
  byCategory: Map<ThreatCategoryKey, { events: number; blocked: number }>,
  capabilities: Set<ComplianceCapability>,
): ComplianceSection {
  const framework = COMPLIANCE_FRAMEWORKS[id];
  return {
    framework: { id, name: framework.name, edition: framework.edition, mappingVersion: COMPLIANCE_MAPPING_VERSION },
    controls: Object.values(framework.controls).map((control) => {
      const categories = (Object.keys(framework.findings) as ThreatCategoryKey[]).filter((key) => framework.findings[key].includes(control.id) && byCategory.has(key));
      return {
        ...control,
        findings: categories.reduce((n, key) => n + byCategory.get(key)!.events, 0),
        blocked: categories.reduce((n, key) => n + byCategory.get(key)!.blocked, 0),
        categories: categories.map((key) => THREAT_CATEGORIES[key].title),
        capabilities: (Object.keys(framework.capabilities) as ComplianceCapability[]).filter((c) => capabilities.has(c) && framework.capabilities[c].includes(control.id)).map((c) => CAPABILITY_TITLES[c]),
      };
    }),
    disclaimer: `GuardBee's mapping (${COMPLIANCE_MAPPING_VERSION}) of its controls and findings to ${framework.name}: evidence for an assessment, not a certification of compliance.`,
  };
}

export interface Signature {
  sha256: string;
  algorithm?: "ed25519";
  publicKey?: string;
  value?: string;
}

export interface SignedReport {
  report: SecurityReport;
  signature: Signature;
}

const count = <K extends string>(into: Map<K, number>, key: K, by = 1) => into.set(key, (into.get(key) ?? 0) + by);
const top = (map: Map<string, number>, n: number) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

export function buildReport(jsonl: string, options: { from: Date; to: Date; file: string; now?: Date; framework?: ComplianceFrameworkId }): SecurityReport {
  const chain = verifyAuditChain(jsonl);
  const events: AuditEvent[] = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const event = JSON.parse(line) as AuditEvent;
      const at = Date.parse(event.ts);
      if (at >= options.from.getTime() && at < options.to.getTime()) events.push(event);
    } catch {
      // The chain check above reports a broken line
    }
  }

  const byCategory = new Map<ThreatCategoryKey, { events: number; blocked: number; examples: Set<string> }>();
  const pii = new Map<string, number>();
  const rules = new Map<string, number>();
  const tools = new Map<string, number>();
  const sessions = new Set<string>();
  const users = new Set<string>();
  const totals = { events: events.length, toolCalls: 0, blocked: 0, warnings: 0, toxicFlows: 0, approvals: 0, sessions: 0, users: 0 };

  for (const event of events) {
    if (event.sessionId) sessions.add(event.sessionId);
    if (event.user) users.add(event.user);
    if (event.type === "tool_call") totals.toolCalls++;
    if (event.type === "blocked") totals.blocked++;
    if (event.type === "warn") totals.warnings++;
    if (event.type === "toxic_flow") totals.toxicFlows++;
    if (event.type === "approval") totals.approvals++;
    for (const [category, n] of Object.entries(event.piiHits ?? {})) count(pii, category, n);
    if (event.ruleId && (event.type === "blocked" || event.type === "toxic_flow")) count(rules, event.ruleId);
    if (event.tool && (event.type === "blocked" || event.type === "toxic_flow")) count(tools, event.tool);
    const key = classifyEvent(event);
    if (!key) continue;
    const entry = byCategory.get(key) ?? { events: 0, blocked: 0, examples: new Set<string>() };
    entry.events++;
    if (event.type === "blocked" || event.type === "toxic_flow") entry.blocked++;
    if (event.reason && entry.examples.size < 5) entry.examples.add(event.reason.slice(0, 200));
    byCategory.set(key, entry);
  }
  totals.sessions = sessions.size;
  totals.users = users.size;

  const lastHash = [...events].reverse().find((event) => event.hash)?.hash ?? null;
  return {
    schema: "guardbee.security-report/1",
    generatedAt: (options.now ?? new Date()).toISOString(),
    period: { from: options.from.toISOString(), to: options.to.toISOString() },
    source: { file: options.file, events: events.length, chain: chain.ok ? { ok: true, detail: `${chain.events} events, hash chain intact` } : { ok: false, detail: `broken at line ${chain.line}: ${chain.reason}` }, lastHash },
    totals,
    categories: (Object.keys(THREAT_CATEGORIES) as ThreatCategoryKey[])
      .filter((key) => byCategory.has(key))
      .map((key) => {
        const { id, title, owasp, atlas } = THREAT_CATEGORIES[key];
        const entry = byCategory.get(key)!;
        return { id, title, owasp: [...owasp], atlas: [...atlas], events: entry.events, blocked: entry.blocked, examples: [...entry.examples] };
      }),
    personalData: Object.fromEntries(top(pii, 50)),
    topRules: top(rules, 10).map(([ruleId, n]) => ({ ruleId, count: n })),
    topTools: top(tools, 10).map(([tool, n]) => ({ tool, blocked: n })),
    ...(options.framework ? { compliance: complianceSection(options.framework, byCategory, capabilitiesSeen(events, chain.ok)) } : {}),
  };
}

/** The bytes the digest and the signature cover: the report with keys in a fixed order. */
function canonical(report: SecurityReport): Buffer {
  return Buffer.from(stable(report), "utf8");
}

export function signReport(report: SecurityReport, privateKeyPem?: string): SignedReport {
  const bytes = canonical(report);
  const signature: Signature = { sha256: createHash("sha256").update(bytes).digest("hex") };
  if (privateKeyPem) {
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error(`the signing key must be Ed25519 (got ${key.asymmetricKeyType})`);
    signature.algorithm = "ed25519";
    signature.publicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
    signature.value = sign(null, bytes, key).toString("base64");
  }
  return { report, signature };
}

export type ReportCheck = { ok: true; signed: boolean } | { ok: false; reason: string };

/**
 * Check a signed report: the digest always, the signature when there is one.
 * `trustedPublicKey` pins who must have signed it; without it the embedded
 * key only proves the report was not changed after signing.
 */
export function verifyReport(signed: SignedReport, trustedPublicKey?: string): ReportCheck {
  const bytes = canonical(signed.report);
  if (createHash("sha256").update(bytes).digest("hex") !== signed.signature.sha256) return { ok: false, reason: "the report does not match its SHA-256 (it was changed)" };
  if (!signed.signature.value) return trustedPublicKey ? { ok: false, reason: "the report is not signed" } : { ok: true, signed: false };
  const keyPem = trustedPublicKey ?? signed.signature.publicKey;
  if (!keyPem) return { ok: false, reason: "no public key to check the signature with" };
  if (trustedPublicKey && signed.signature.publicKey && createPublicKey(trustedPublicKey).export({ type: "spki", format: "der" }).compare(createPublicKey(signed.signature.publicKey).export({ type: "spki", format: "der" })) !== 0) {
    return { ok: false, reason: "signed with a different key than the trusted one" };
  }
  const valid = verify(null, bytes, createPublicKey(keyPem), Buffer.from(signed.signature.value, "base64"));
  return valid ? { ok: true, signed: true } : { ok: false, reason: "the signature does not match" };
}
