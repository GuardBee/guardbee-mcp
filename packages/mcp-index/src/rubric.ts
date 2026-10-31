import type { McpGrade, McpIndexReason } from "@guardbee/guard-core";
import type { KnownIssue } from "./osv.js";
import type { CodeFinding } from "./scan.js";
import type { PackageFacts } from "./sources.js";

/**
 * The scoring rubric. RUBRIC.md documents it; changing a number here changes
 * RUBRIC_VERSION and the document in the same commit, so a published grade
 * always names the rules that made it.
 */
export const RUBRIC_VERSION = "2026-11";

export type ProvenanceOutcome = "verified" | "absent" | "failed" | "unknown";

export interface ScoreInput {
  facts: PackageFacts;
  findings: CodeFinding[];
  issues: KnownIssue[];
  provenance: ProvenanceOutcome;
  /** The registry entry names a source repository. */
  registryRepository?: string;
  now: Date;
}

export interface Score {
  grade: McpGrade;
  score: number;
  subscores: { code: number; supplyChain: number; maintenance: number };
  reasons: McpIndexReason[];
}

/** Points per finding by severity, and the most a category can take off. */
const CODE_POINTS = { critical: 25, high: 8, medium: 2, low: 0 } as const;
const CODE_CAP = 60;
const VULN_POINTS = { critical: 40, high: 20, medium: 5, low: 1, unknown: 5 } as const;

const DAY = 86_400_000;

export function gradeOf(score: number): McpGrade {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
}

export function score(input: ScoreInput): Score {
  const reasons: McpIndexReason[] = [];
  const take = (category: McpIndexReason["category"], id: string, points: number, detail: string) => {
    if (points !== 0) reasons.push({ category, id, points: -points, detail });
  };

  // ── Code: static findings in the shipped source, each rule counted once per package ─────
  const byRule = new Map<string, CodeFinding[]>();
  for (const f of input.findings) {
    if (f.severity === "low") continue;
    const key = `${f.scanner}:${f.id}`;
    byRule.set(key, [...(byRule.get(key) ?? []), f]);
  }
  let codeTaken = 0;
  const ordered = [...byRule.entries()].sort((a, b) => CODE_POINTS[b[1][0]!.severity] - CODE_POINTS[a[1][0]!.severity] || a[0].localeCompare(b[0]));
  for (const [key, list] of ordered) {
    const first = list[0]!;
    const points = Math.min(CODE_POINTS[first.severity], CODE_CAP - codeTaken);
    codeTaken += points;
    take("code", key, points, `${first.severity}: ${first.id} in ${first.file}:${first.line}${list.length > 1 ? ` (+${list.length - 1} more)` : ""}`);
  }
  const leakedSecret = input.findings.some((f) => f.scanner === "secret-scanner" && (f.severity === "critical" || f.severity === "high"));
  const criticalCode = input.findings.some((f) => f.severity === "critical");

  // ── Supply chain ─────────────────────────────────────────────────────────────────
  let supplyTaken = 0;
  const supply = (id: string, points: number, detail: string) => {
    supplyTaken += points;
    take("supply-chain", id, points, detail);
  };
  const malware = input.issues.filter((i) => i.malicious);
  for (const m of malware) supply("malicious-package", 100, `${m.id}${m.summary ? `: ${m.summary}` : ""}`);
  const vulns = input.issues.filter((i) => !i.malicious);
  for (const v of vulns) supply(`vulnerability:${v.id}`, VULN_POINTS[v.severity], `${v.severity}${v.summary ? `: ${v.summary}` : ""}`);
  if (input.facts.installScripts.length) supply("install-scripts", 10, `runs ${input.facts.installScripts.join(", ")} on install`);
  if (input.provenance === "failed") supply("provenance-invalid", 40, "build provenance present but does not verify or does not match the package");
  else if (input.provenance === "absent") supply("no-provenance", 5, "no build provenance (npm provenance / PEP 740 attestation)");

  // ── Maintenance and transparency ──────────────────────────────────────────────
  let maintenanceTaken = 0;
  const maintenance = (id: string, points: number, detail: string) => {
    maintenanceTaken += points;
    take("maintenance", id, points, detail);
  };
  const facts = input.facts;
  if (facts.deprecated) maintenance("deprecated", 20, `marked deprecated: ${facts.deprecated.slice(0, 120)}`);
  if (!facts.repository && !input.registryRepository) maintenance("no-repository", 10, "no source repository linked");
  if (!facts.license) maintenance("no-license", 5, "no license declared");
  const created = facts.createdAt ? Date.parse(facts.createdAt) : NaN;
  if (Number.isFinite(created) && input.now.getTime() - created < 30 * DAY) maintenance("new-package", 5, "first published less than 30 days ago");
  const published = facts.publishedAt ? Date.parse(facts.publishedAt) : NaN;
  if (Number.isFinite(published) && input.now.getTime() - published > 2 * 365 * DAY) maintenance("stale", 5, "this version is more than two years old");

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  let total = clamp(100 - codeTaken - supplyTaken - maintenanceTaken);
  // Caps: some findings decide the grade whatever else is good
  if (malware.length) {
    total = 0;
    reasons.push({ category: "supply-chain", id: "cap:malware", points: 0, detail: "known malicious package: grade F" });
  } else if (leakedSecret) {
    total = Math.min(total, 59);
    reasons.push({ category: "code", id: "cap:secret", points: 0, detail: "a credential is published in the package: grade F" });
  } else if (criticalCode || vulns.some((v) => v.severity === "critical")) {
    total = Math.min(total, 69);
    reasons.push({ category: criticalCode ? "code" : "supply-chain", id: "cap:critical", points: 0, detail: "a critical finding: at most D" });
  }
  return {
    grade: gradeOf(total),
    score: total,
    subscores: { code: clamp(100 - codeTaken), supplyChain: clamp(100 - supplyTaken), maintenance: clamp(100 - maintenanceTaken) },
    reasons,
  };
}
