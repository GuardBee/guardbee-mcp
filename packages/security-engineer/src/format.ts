import type { Assessment, AssessmentSummary, Remediation } from "./client.js";
import type { StackSignal } from "./stack.js";

export function formatAssessments(list: AssessmentSummary[]): string {
  if (list.length === 0) return "No AI Security Engineer assessments yet. Start one at https://app.guardbee.ai/security-engineer";
  return ["Recent assessments:", ...list.map((a) => `- ${a.id} · ${a.hostname ?? "?"} · ${a.status} · risk ${a.riskLevel ?? "n/a"} · ${a.createdAt.slice(0, 10)} · “${a.task}”`)].join("\n");
}

export function formatAssessment(a: Assessment): string {
  const lines = [
    `Assessment ${a.id} — ${a.target ?? a.hostname} — risk ${a.riskLevel ?? "n/a"}`,
    a.techStack.length > 0 ? `Detected on the live site: ${a.techStack.map((t) => t.platform).join(", ")}` : "",
    "",
    "Actionable findings (highest priority first):",
  ];
  for (const f of a.findings) {
    lines.push(
      `${f.priority}. [${f.severity}] ${f.title} (findingId: ${f.id})`,
      `   Why: ${f.whyItMatters}`,
      `   Fix platforms: ${f.fixPlatforms.length > 0 ? f.fixPlatforms.join(", ") : "no template — follow the recommendation manually"}${f.recommendedPlatform ? ` (recommended: ${f.recommendedPlatform})` : ""}`
    );
  }
  if (a.findings.length === 0) lines.push("None.");
  lines.push("", "Next: call detect_stack for this repository, then get_fix for a finding.");
  return lines.filter((l, i) => l !== "" || i > 0).join("\n");
}

export function formatStack(signals: StackSignal[], root: string): string {
  if (signals.length === 0) return `No Next.js, Express, Nginx, Apache or Cloudflare signals found in ${root}. Pass platform explicitly to get_fix.`;
  return [`Stack detected in ${root}:`, ...signals.map((s) => `- ${s.platform}: ${s.evidence}${s.configFile ? ` (config: ${s.configFile})` : ""}`)].join("\n");
}

/** Instructions for the coding agent: GuardBee proposes, the agent edits, the user approves. */
export function formatFix(r: Remediation): string {
  const p = r.proposal;
  const out = [
    `Fix proposal ${r.id} — ${p.title} (${p.platformLabel})`,
    `Strategy: ${p.strategy}`,
    "",
  ];
  if (p.configDiff) out.push("Apply this diff to the configuration:", "```diff", p.configDiff, "```", "");
  if (p.configDiffNote) out.push(`Note: ${p.configDiffNote}`, "");
  for (const c of p.code) out.push(`${c.title}:`, "```" + c.language, c.code, "```", "");
  out.push("Steps:", ...p.steps.map((s) => `- ${s}`));
  if (p.caveats.length > 0) out.push("", "Caveats (tell the user):", ...p.caveats.map((c) => `- ${c}`));
  out.push(
    "",
    "Instructions for the coding agent:",
    "1. Make the change in this repository with minimal edits. If the project already defines these headers or settings, update them instead of duplicating.",
    "2. Show the user the diff and let them approve it. Do not deploy unless they ask.",
    `3. After the change is committed, call report_applied with remediationId="${r.id}" and the commit SHA or PR URL as ref.`,
    `4. After it is deployed, call verify_fix with remediationId="${r.id}". ${p.verification.description}`
  );
  return out.join("\n");
}

export function formatVerification(r: Remediation): string {
  if (!r.verification) return `Status: ${r.status}`;
  const head = { resolved: "✅ Resolved", still_present: "⚠️ Not resolved yet", inconclusive: "❔ Inconclusive" }[r.verification.outcome] ?? r.verification.outcome;
  return `${head} — ${r.verification.detail} (checked ${r.verification.checkedAt})${r.verification.outcome === "still_present" ? "\nIs the change deployed? Re-run verify_fix after deployment." : ""}`;
}
