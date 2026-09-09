// Standalone privacy policy text analysis — no API key required

export interface PolicySignal {
  id: string;
  label: string;
  found: boolean;
  excerpt?: string;
}

export interface PolicyAnalysis {
  url: string;
  wordCount: number;
  signals: PolicySignal[];
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  summary: string;
}

// Patterns to detect in privacy policy text
const GDPR_SIGNALS: Array<{ id: string; label: string; patterns: RegExp[] }> = [
  {
    id: "legal-basis",
    label: "Legal basis for processing",
    patterns: [/legal basis/i, /lawful basis/i, /legitimate interest/i, /hukuki dayanak/i],
  },
  {
    id: "data-subject-rights",
    label: "Data subject rights",
    patterns: [/right to access/i, /right to erasure/i, /right to rectification/i, /right to object/i, /data subject rights/i],
  },
  {
    id: "retention",
    label: "Data retention periods",
    patterns: [/retention period/i, /we keep.{0,40}for/i, /stored for/i, /saklama süresi/i, /muhafaza süresi/i],
  },
  {
    id: "third-parties",
    label: "Third-party disclosure",
    patterns: [/third.?part/i, /üçüncü taraf/i, /service provider/i, /hizmet sağlayıcı/i],
  },
  {
    id: "international-transfers",
    label: "International data transfers",
    patterns: [/international transfer/i, /transfer.{0,30}outside/i, /yurt dışı/i, /cross.?border/i, /adequate/i],
  },
  {
    id: "dpo-contact",
    label: "DPO / Contact information",
    patterns: [/data protection officer/i, /DPO/i, /kvkk@/i, /privacy@/i, /gdpr@/i, /veri koruma/i],
  },
  {
    id: "cookies",
    label: "Cookie information",
    patterns: [/cookie/i, /çerez/i, /tracking/i],
  },
  {
    id: "consent-withdrawal",
    label: "Consent withdrawal",
    patterns: [/withdraw.{0,20}consent/i, /revoke consent/i, /rızanızı geri al/i, /opt.?out/i],
  },
  {
    id: "complaints",
    label: "Supervisory authority / Complaint rights",
    patterns: [/supervisory authority/i, /lodge a complaint/i, /KVKK'ya başvur/i, /kişisel verileri koruma kurulu/i, /data protection authority/i],
  },
  {
    id: "automated-decisions",
    label: "Automated decision-making",
    patterns: [/automated.{0,30}decision/i, /profiling/i, /otomatik karar/i, /profillleme/i],
  },
];

function extractExcerpt(text: string, pattern: RegExp, maxLen = 120): string | undefined {
  const m = text.match(pattern);
  if (!m || m.index === undefined) return undefined;
  const start = Math.max(0, m.index - 20);
  const end = Math.min(text.length, m.index + maxLen);
  return "..." + text.slice(start, end).replace(/\s+/g, " ").trim() + "...";
}

export function analyzePrivacyPolicyText(url: string, text: string): PolicyAnalysis {
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const signals: PolicySignal[] = GDPR_SIGNALS.map(({ id, label, patterns }) => {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { id, label, found: true, excerpt: extractExcerpt(text, pattern) };
      }
    }
    return { id, label, found: false };
  });

  const foundCount = signals.filter((s) => s.found).length;
  const score = Math.round((foundCount / signals.length) * 100);

  const grade: PolicyAnalysis["grade"] =
    score >= 90 ? "A" :
    score >= 75 ? "B" :
    score >= 60 ? "C" :
    score >= 40 ? "D" : "F";

  const missing = signals.filter((s) => !s.found).map((s) => s.label);
  const summary =
    score >= 90
      ? "Privacy policy covers all key requirements."
      : `Missing ${missing.length} element(s): ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`;

  return { url, wordCount, signals, score, grade, summary };
}

// Detect privacy policy link in HTML
export function findPrivacyPolicyUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /href="([^"]*privacy[^"]*?)"/gi,
    /href="([^"]*gizlilik[^"]*?)"/gi,
    /href="([^"]*aydinlatma[^"]*?)"/gi,
    /href="([^"]*kisisel-veri[^"]*?)"/gi,
    /href="([^"]*cookie-policy[^"]*?)"/gi,
    /href="([^"]*cerez[^"]*?)"/gi,
  ];

  for (const pattern of patterns) {
    const m = pattern.exec(html);
    if (m && m[1]) {
      const href = m[1];
      if (href.startsWith("http")) return href;
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Detect cookie consent banner signals in HTML
export function detectCookieBanner(html: string): { detected: boolean; signals: string[] } {
  const signals: string[] = [];
  const checks: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /cookie.*consent|consent.*cookie/i, label: "Cookie consent text" },
    { pattern: /cookiebot|onetrust|cookiehub|quantcast|trustarc|didomi|usercentrics|axeptio|cookielaw\.org/i, label: "CMP platform detected" },
    { pattern: /data-cookieconsent|data-consent/i, label: "Consent data attributes" },
    { pattern: /gdpr.*cookie|cookie.*gdpr/i, label: "GDPR cookie reference" },
    { pattern: /çerez.*onay|onay.*çerez|çerez.*kabul/i, label: "KVKK cookie consent text (TR)" },
    { pattern: /accept.{0,20}cookie|cookie.{0,20}accept/i, label: "Accept cookies button" },
    { pattern: /reject.{0,20}cookie|cookie.{0,20}reject|decline.{0,20}cookie/i, label: "Reject cookies option" },
  ];

  for (const { pattern, label } of checks) {
    if (pattern.test(html)) signals.push(label);
  }

  return { detected: signals.length > 0, signals };
}

export function formatPolicyAnalysis(analysis: PolicyAnalysis): string {
  const lines = [
    `Privacy Policy Analysis: ${analysis.url}`,
    "─".repeat(60),
    `Score    : ${analysis.score}/100  (Grade: ${analysis.grade})`,
    `Words    : ${analysis.wordCount.toLocaleString()}`,
    `Summary  : ${analysis.summary}`,
    "",
    "Requirements checklist:",
  ];

  for (const s of analysis.signals) {
    const icon = s.found ? "✅" : "❌";
    lines.push(`  ${icon}  ${s.label}`);
    if (!s.found) {
      // give a hint
      lines.push(`       └─ Add a section covering this topic`);
    }
  }

  return lines.join("\n");
}
