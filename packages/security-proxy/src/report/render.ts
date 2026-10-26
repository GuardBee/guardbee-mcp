import type { SecurityReport, SignedReport } from "./report.js";

export type Lang = "en" | "tr";

const TEXT = {
  en: {
    title: "GuardBee security report",
    period: "Period",
    generated: "Generated",
    source: "Audit log",
    chain: "Hash chain",
    lastHash: "Last event hash",
    summary: "Summary",
    events: "Events",
    toolCalls: "Tool calls",
    blocked: "Blocked",
    warnings: "Warnings",
    toxicFlows: "Toxic flows",
    approvals: "Approvals",
    sessions: "Sessions",
    users: "Users",
    findings: "Findings by framework",
    category: "Category",
    owasp: "OWASP LLM Top 10",
    atlas: "MITRE ATLAS",
    examples: "Examples",
    none: "Nothing in this period.",
    pii: "Personal data seen (counts only)",
    rules: "Rules that blocked most",
    tools: "Tools blocked most",
    integrity: "Integrity",
    sha: "SHA-256 of the report",
    signature: "Ed25519 signature",
    unsigned: "not signed",
    verify: "Check with: guardbee-proxy verify-report <this file> [--pubkey <key.pem>]",
    compliance: "Compliance mapping",
    control: "Requirement",
    evidence: "Evidence in this period",
    noEvidence: "none in this period",
    mapping: "Mapping",
  },
  tr: {
    title: "GuardBee güvenlik raporu",
    period: "Dönem",
    generated: "Oluşturulma",
    source: "Audit log",
    chain: "Hash zinciri",
    lastHash: "Son olay hash'i",
    summary: "Özet",
    events: "Olay",
    toolCalls: "Tool çağrısı",
    blocked: "Engellenen",
    warnings: "Uyarı",
    toxicFlows: "Toxic flow",
    approvals: "Onay",
    sessions: "Oturum",
    users: "Kullanıcı",
    findings: "Çerçevelere göre bulgular",
    category: "Kategori",
    owasp: "OWASP LLM Top 10",
    atlas: "MITRE ATLAS",
    examples: "Örnekler",
    none: "Bu dönemde bulgu yok.",
    pii: "Görülen kişisel veri (yalnızca sayılar)",
    rules: "En çok engelleyen kurallar",
    tools: "En çok engellenen tool'lar",
    integrity: "Bütünlük",
    sha: "Raporun SHA-256'sı",
    signature: "Ed25519 imzası",
    unsigned: "imzasız",
    verify: "Doğrulama: guardbee-proxy verify-report <bu dosya> [--pubkey <anahtar.pem>]",
    compliance: "Uyumluluk eşlemesi",
    control: "Gereksinim",
    evidence: "Bu dönemdeki kanıt",
    noEvidence: "bu dönemde yok",
    mapping: "Eşleme",
  },
} as const;

const refs = (list: { id: string; name: string }[]) => list.map((r) => `${r.id} ${r.name}`).join("; ");

export function renderMarkdown(signed: SignedReport, lang: Lang = "en"): string {
  const t = TEXT[lang];
  const r: SecurityReport = signed.report;
  const lines = [
    `# ${t.title}`,
    "",
    `- **${t.period}:** ${r.period.from} → ${r.period.to}`,
    `- **${t.generated}:** ${r.generatedAt}`,
    `- **${t.source}:** \`${r.source.file}\` (${r.source.events} ${t.events.toLowerCase()})`,
    `- **${t.chain}:** ${r.source.chain.ok ? "✅" : "❌"} ${r.source.chain.detail}`,
    `- **${t.lastHash}:** \`${r.source.lastHash ?? "-"}\``,
    "",
    `## ${t.summary}`,
    "",
    `| ${t.events} | ${t.toolCalls} | ${t.blocked} | ${t.warnings} | ${t.toxicFlows} | ${t.approvals} | ${t.sessions} | ${t.users} |`,
    "|---|---|---|---|---|---|---|---|",
    `| ${r.totals.events} | ${r.totals.toolCalls} | ${r.totals.blocked} | ${r.totals.warnings} | ${r.totals.toxicFlows} | ${r.totals.approvals} | ${r.totals.sessions} | ${r.totals.users} |`,
    "",
    `## ${t.findings}`,
    "",
  ];
  if (r.categories.length === 0) lines.push(t.none, "");
  else {
    lines.push(`| ${t.category} | ${t.owasp} | ${t.atlas} | ${t.events} | ${t.blocked} |`, "|---|---|---|---|---|");
    for (const c of r.categories) lines.push(`| ${c.title} | ${refs(c.owasp)} | ${refs(c.atlas)} | ${c.events} | ${c.blocked} |`);
    lines.push("");
    for (const c of r.categories) {
      if (c.examples.length === 0) continue;
      lines.push(`**${c.title}** — ${t.examples}:`, ...c.examples.map((e) => `- ${e.replace(/\|/g, "\\|")}`), "");
    }
  }
  if (r.compliance) {
    const c = r.compliance;
    lines.push(`## ${t.compliance}: ${c.framework.name}`, "", `${c.framework.edition} · ${t.mapping} ${c.framework.mappingVersion}`, "", `| ${t.control} | ${t.evidence} | ${t.events} | ${t.blocked} |`, "|---|---|---|---|");
    for (const control of c.controls) {
      const evidence = [...control.capabilities, ...control.categories].join("; ") || t.noEvidence;
      lines.push(`| **${control.id}** ${control.name} (${control.citation}) | ${evidence.replace(/\|/g, "\\|")} | ${control.findings} | ${control.blocked} |`);
    }
    lines.push("", `_${c.disclaimer}_`, "");
  }
  if (Object.keys(r.personalData).length > 0) {
    lines.push(`## ${t.pii}`, "", ...Object.entries(r.personalData).map(([k, v]) => `- \`${k}\`: ${v}`), "");
  }
  if (r.topRules.length > 0) lines.push(`## ${t.rules}`, "", ...r.topRules.map((x) => `- \`${x.ruleId}\`: ${x.count}`), "");
  if (r.topTools.length > 0) lines.push(`## ${t.tools}`, "", ...r.topTools.map((x) => `- \`${x.tool}\`: ${x.blocked}`), "");
  lines.push(
    `## ${t.integrity}`,
    "",
    `- ${t.sha}: \`${signed.signature.sha256}\``,
    `- ${t.signature}: ${signed.signature.value ? `\`${signed.signature.value}\`` : t.unsigned}`,
    `- ${t.verify}`,
    "",
    "<!-- guardbee-report",
    JSON.stringify(signed),
    "-->",
    "",
  );
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderHtml(signed: SignedReport, lang: Lang = "en"): string {
  const t = TEXT[lang];
  const r = signed.report;
  const stat = (label: string, value: number) => `<div class="stat"><b>${value}</b><span>${esc(label)}</span></div>`;
  const rows = r.categories
    .map(
      (c) =>
        `<tr><td>${esc(c.title)}${c.examples.length ? `<ul>${c.examples.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}</td><td>${c.owasp.map((o) => `<code>${esc(o.id)}</code> ${esc(o.name)}`).join("<br>")}</td><td>${c.atlas.map((a) => `<code>${esc(a.id)}</code> ${esc(a.name)}`).join("<br>")}</td><td class="n">${c.events}</td><td class="n">${c.blocked}</td></tr>`,
    )
    .join("");
  const list = (items: [string, number][]) => `<ul>${items.map(([k, v]) => `<li><code>${esc(k)}</code> ${v}</li>`).join("")}</ul>`;
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e5e5e5;--accent:#b8860b}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#999;--line:#333;--accent:#e0b040}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px}h2{margin-top:32px;border-bottom:1px solid var(--line);padding-bottom:4px}
.meta{color:var(--muted);font-size:13px}.stats{display:flex;flex-wrap:wrap;gap:12px}
.stat{border:1px solid var(--line);border-radius:8px;padding:8px 14px;min-width:90px}.stat b{display:block;font-size:22px}.stat span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}.n{text-align:right}
td ul{margin:4px 0 0;padding-left:18px;color:var(--muted);font-size:12px}code{font-size:12px;color:var(--accent)}
.ok{color:#2e7d32}.bad{color:#c62828}.sig{word-break:break-all;font-size:12px}
@media (max-width:640px){table,tbody,tr,td{display:block}td{border:0;padding:4px 0}tr{border-bottom:1px solid var(--line);padding:8px 0}.n{text-align:left}}
</style></head><body>
<h1>${esc(t.title)}</h1>
<div class="meta">${esc(t.period)}: ${esc(r.period.from)} → ${esc(r.period.to)} · ${esc(t.generated)}: ${esc(r.generatedAt)}<br>
${esc(t.source)}: <code>${esc(r.source.file)}</code> · ${esc(t.chain)}: <span class="${r.source.chain.ok ? "ok" : "bad"}">${esc(r.source.chain.detail)}</span></div>
<h2>${esc(t.summary)}</h2>
<div class="stats">${stat(t.events, r.totals.events)}${stat(t.toolCalls, r.totals.toolCalls)}${stat(t.blocked, r.totals.blocked)}${stat(t.warnings, r.totals.warnings)}${stat(t.toxicFlows, r.totals.toxicFlows)}${stat(t.approvals, r.totals.approvals)}${stat(t.sessions, r.totals.sessions)}${stat(t.users, r.totals.users)}</div>
<h2>${esc(t.findings)}</h2>
${r.categories.length ? `<table><thead><tr><th>${esc(t.category)}</th><th>${esc(t.owasp)}</th><th>${esc(t.atlas)}</th><th class="n">${esc(t.events)}</th><th class="n">${esc(t.blocked)}</th></tr></thead><tbody>${rows}</tbody></table>` : `<p>${esc(t.none)}</p>`}
${r.compliance ? complianceHtml(r.compliance, t) : ""}
${Object.keys(r.personalData).length ? `<h2>${esc(t.pii)}</h2>${list(Object.entries(r.personalData))}` : ""}
${r.topRules.length ? `<h2>${esc(t.rules)}</h2>${list(r.topRules.map((x) => [x.ruleId, x.count]))}` : ""}
${r.topTools.length ? `<h2>${esc(t.tools)}</h2>${list(r.topTools.map((x) => [x.tool, x.blocked]))}` : ""}
<h2>${esc(t.integrity)}</h2>
<p class="sig">${esc(t.sha)}: <code>${esc(signed.signature.sha256)}</code><br>${esc(t.signature)}: ${signed.signature.value ? `<code>${esc(signed.signature.value)}</code>` : esc(t.unsigned)}<br>${esc(t.lastHash)}: <code>${esc(r.source.lastHash ?? "-")}</code></p>
<p class="meta">${esc(t.verify)}</p>
<script type="application/json" id="guardbee-report">${JSON.stringify(signed).replace(/</g, "\\u003c")}</script>
</body></html>
`;
}

function complianceHtml(c: NonNullable<SecurityReport["compliance"]>, t: (typeof TEXT)[Lang]): string {
  const rows = c.controls
    .map((control) => {
      const evidence = [...control.capabilities, ...control.categories];
      return `<tr><td><code>${esc(control.id)}</code> ${esc(control.name)}<ul><li>${esc(control.citation)}</li></ul></td><td>${evidence.length ? evidence.map(esc).join("<br>") : `<span class="meta">${esc(t.noEvidence)}</span>`}</td><td class="n">${control.findings}</td><td class="n">${control.blocked}</td></tr>`;
    })
    .join("");
  return `<h2>${esc(t.compliance)}: ${esc(c.framework.name)}</h2>
<p class="meta">${esc(c.framework.edition)} · ${esc(t.mapping)} ${esc(c.framework.mappingVersion)}</p>
<table><thead><tr><th>${esc(t.control)}</th><th>${esc(t.evidence)}</th><th class="n">${esc(t.events)}</th><th class="n">${esc(t.blocked)}</th></tr></thead><tbody>${rows}</tbody></table>
<p class="meta"><em>${esc(c.disclaimer)}</em></p>`;
}

/** The signed report inside a .json, .md or .html file. */
export function extractSigned(text: string): SignedReport {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as SignedReport;
  const html = /<script type="application\/json" id="guardbee-report">([\s\S]*?)<\/script>/.exec(text);
  if (html) return JSON.parse(html[1]!) as SignedReport;
  const md = /<!-- guardbee-report\n([\s\S]*?)\n-->/.exec(text);
  if (md) return JSON.parse(md[1]!) as SignedReport;
  throw new Error("no GuardBee report found in this file");
}
