// Compliance framework definitions and requirement catalogs

export type Framework = "KVKK" | "GDPR" | "CCPA";

export interface Requirement {
  id: string;
  framework: Framework;
  category: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  legalBasis?: string; // e.g. "KVKK Art. 10", "GDPR Art. 13"
}

export const REQUIREMENTS: Requirement[] = [
  // ── KVKK ────────────────────────────────────────────────────────────────────
  {
    id: "kvkk-privacy-notice",
    framework: "KVKK",
    category: "Transparency",
    title: "Privacy notice / Aydınlatma metni",
    description: "Website must have a visible privacy notice (aydınlatma metni) accessible from every page.",
    severity: "critical",
    legalBasis: "KVKK Art. 10",
  },
  {
    id: "kvkk-cookie-consent",
    framework: "KVKK",
    category: "Consent",
    title: "Cookie consent banner",
    description: "Non-essential cookies must not be set before explicit user consent.",
    severity: "critical",
    legalBasis: "KVKK Art. 5/1, KVKK Çerez Kılavuzu",
  },
  {
    id: "kvkk-data-subject-rights",
    framework: "KVKK",
    category: "Rights",
    title: "Data subject request channel",
    description: "A clear channel for data subject rights requests (başvuru yolu) must be provided.",
    severity: "high",
    legalBasis: "KVKK Art. 11, 13",
  },
  {
    id: "kvkk-form-consent",
    framework: "KVKK",
    category: "Consent",
    title: "Form consent checkboxes",
    description: "Forms collecting personal data must include explicit, unchecked consent boxes.",
    severity: "high",
    legalBasis: "KVKK Art. 5/1",
  },
  {
    id: "kvkk-tracker-disclosure",
    framework: "KVKK",
    category: "Transparency",
    title: "Third-party tracker disclosure",
    description: "All third-party trackers used on the site must be disclosed in the privacy notice.",
    severity: "high",
    legalBasis: "KVKK Art. 10",
  },
  {
    id: "kvkk-verbis",
    framework: "KVKK",
    category: "Registration",
    title: "VERBİS registration",
    description: "Data controllers processing personal data must be registered in VERBİS.",
    severity: "high",
    legalBasis: "KVKK Art. 16",
  },
  {
    id: "kvkk-cross-border",
    framework: "KVKK",
    category: "Data Transfers",
    title: "Cross-border data transfer safeguards",
    description: "International transfers of personal data require explicit consent or adequate protection.",
    severity: "high",
    legalBasis: "KVKK Art. 9",
  },
  {
    id: "kvkk-cookie-categories",
    framework: "KVKK",
    category: "Consent",
    title: "Granular cookie categories",
    description: "Cookie banner must allow users to accept/reject by category (functional, analytics, marketing).",
    severity: "medium",
    legalBasis: "KVKK Çerez Kılavuzu",
  },
  {
    id: "kvkk-children-data",
    framework: "KVKK",
    category: "Special Categories",
    title: "Children's data protection",
    description: "Processing data of children under 18 requires parental consent.",
    severity: "critical",
    legalBasis: "KVKK Art. 6",
  },

  // ── GDPR ────────────────────────────────────────────────────────────────────
  {
    id: "gdpr-privacy-policy",
    framework: "GDPR",
    category: "Transparency",
    title: "Privacy policy",
    description: "Website must have a comprehensive privacy policy covering all GDPR Art. 13/14 elements.",
    severity: "critical",
    legalBasis: "GDPR Art. 13-14",
  },
  {
    id: "gdpr-cookie-consent",
    framework: "GDPR",
    category: "Consent",
    title: "Cookie consent (prior consent)",
    description: "Non-essential cookies must require prior explicit consent. Pre-ticked boxes are invalid.",
    severity: "critical",
    legalBasis: "GDPR Art. 6(1)(a), ePrivacy Directive",
  },
  {
    id: "gdpr-legal-basis",
    framework: "GDPR",
    category: "Lawfulness",
    title: "Legal basis for processing",
    description: "Privacy policy must state the legal basis for each processing activity.",
    severity: "high",
    legalBasis: "GDPR Art. 13(1)(c)",
  },
  {
    id: "gdpr-data-subject-rights",
    framework: "GDPR",
    category: "Rights",
    title: "Data subject rights",
    description: "Privacy policy must list all 8 data subject rights and how to exercise them.",
    severity: "high",
    legalBasis: "GDPR Art. 13(2)(b), Art. 15-22",
  },
  {
    id: "gdpr-dpo",
    framework: "GDPR",
    category: "Accountability",
    title: "DPO contact information",
    description: "If a DPO is required, their contact details must be published.",
    severity: "medium",
    legalBasis: "GDPR Art. 37-39",
  },
  {
    id: "gdpr-retention",
    framework: "GDPR",
    category: "Data Minimisation",
    title: "Retention periods",
    description: "Privacy policy must specify data retention periods or criteria for determining them.",
    severity: "medium",
    legalBasis: "GDPR Art. 13(2)(a)",
  },
  {
    id: "gdpr-transfers",
    framework: "GDPR",
    category: "Data Transfers",
    title: "International transfer safeguards",
    description: "Transfers outside EEA require adequacy decision, SCCs, or other safeguards.",
    severity: "high",
    legalBasis: "GDPR Art. 44-49",
  },
  {
    id: "gdpr-breach-notification",
    framework: "GDPR",
    category: "Security",
    title: "Data breach notification",
    description: "Internal process for 72-hour breach notification to supervisory authority must exist.",
    severity: "high",
    legalBasis: "GDPR Art. 33",
  },

  // ── CCPA ────────────────────────────────────────────────────────────────────
  {
    id: "ccpa-privacy-policy",
    framework: "CCPA",
    category: "Transparency",
    title: "CCPA-compliant privacy policy",
    description: "Privacy policy must disclose categories of personal information collected and sold.",
    severity: "critical",
    legalBasis: "CCPA § 1798.100",
  },
  {
    id: "ccpa-do-not-sell",
    framework: "CCPA",
    category: "Rights",
    title: "Do Not Sell or Share link",
    description: "'Do Not Sell or Share My Personal Information' link must be visible on homepage.",
    severity: "critical",
    legalBasis: "CCPA § 1798.120",
  },
  {
    id: "ccpa-gpc",
    framework: "CCPA",
    category: "Rights",
    title: "Global Privacy Control (GPC) support",
    description: "Website must honor the GPC browser signal as an opt-out from sale/sharing.",
    severity: "high",
    legalBasis: "CPRA § 1798.135(b)",
  },
  {
    id: "ccpa-data-subject-rights",
    framework: "CCPA",
    category: "Rights",
    title: "Consumer rights mechanisms",
    description: "Must provide methods to exercise access, deletion, and opt-out rights.",
    severity: "high",
    legalBasis: "CCPA § 1798.105, 1798.110",
  },
];

export const FRAMEWORK_MODULES: Record<Framework, string[]> = {
  KVKK: [
    "kvkk-privacy-notice",
    "kvkk-cookie-consent",
    "kvkk-data-subject-contact",
    "kvkk-form-consent",
    "kvkk-tracker-disclosure",
    "kvkk-cookie-categories",
    "kvkk-verbis",
    "kvkk-cross-border",
    "kvkk-notice-quality",
    "kvkk-notice-sufficiency",
    "kvkk-prechecked-consent",
    "kvkk-marketing-consent",
    "kvkk-children-data",
    "kvkk-sensitive-data",
    "kvkk-consent-runtime",
    "kvkk-reject-behavior",
  ],
  GDPR: [
    "kvkk-privacy-notice",
    "kvkk-cookie-consent",
    "kvkk-data-subject-contact",
    "kvkk-form-consent",
    "kvkk-tracker-disclosure",
    "kvkk-cookie-categories",
    "kvkk-prechecked-consent",
    "kvkk-reject-behavior",
  ],
  CCPA: [
    "ccpa-do-not-sell",
    "ccpa-gpc",
    "kvkk-cookie-consent",
    "kvkk-tracker-disclosure",
  ],
};

export const SCENARIO_MAP: Record<Framework, "kvkkFocus" | "gdprFocus" | "ccpaFocus"> = {
  KVKK: "kvkkFocus",
  GDPR: "gdprFocus",
  CCPA: "ccpaFocus",
};

export function getRequirements(frameworks: Framework[]): Requirement[] {
  return REQUIREMENTS.filter((r) => frameworks.includes(r.framework));
}
