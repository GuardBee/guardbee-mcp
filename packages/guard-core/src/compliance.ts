import type { ThreatCategoryKey } from "./frameworks.js";

/**
 * Where GuardBee's controls and findings sit in the frameworks AI governance
 * is audited against: the EU AI Act, ISO/IEC 42001, SOC 2 and the NIST AI RMF.
 *
 * These tables are GuardBee's reading of the texts, versioned in
 * COMPLIANCE_MAPPING_VERSION. They show which requirement a control or a
 * finding is evidence for; they support an assessment and do not certify
 * compliance with anything. Every entry cites the article or control it
 * refers to.
 */
export const COMPLIANCE_MAPPING_VERSION = "2026-10";

export type ComplianceFrameworkId = "eu-ai-act" | "iso42001" | "soc2" | "nist-ai-rmf";

export interface ComplianceControl {
  id: string;
  name: string;
  /** Where the requirement is written. */
  citation: string;
}

/** A gateway capability that is evidence for controls whatever the events were. */
export type ComplianceCapability = "auditLog" | "humanApproval" | "accessControl" | "supplyChain" | "dataMasking" | "monitoring";

export const CAPABILITY_TITLES: Record<ComplianceCapability, string> = {
  auditLog: "Hash-chained audit log of every tool call, refusal and approval",
  humanApproval: "Human approval before calls the policy holds (approve rules, toxic flows)",
  accessControl: "Per-user and per-group policy, quotas and LLM access",
  supplyChain: "Tool pinning, rug-pull detection and build-provenance checks of servers",
  dataMasking: "Personal data and secrets masked or tokenized before they leave",
  monitoring: "Injection, poisoning and anomaly detection on live traffic",
};

export interface ComplianceFramework {
  id: ComplianceFrameworkId;
  name: string;
  /** The edition the controls are taken from. */
  edition: string;
  controls: Record<string, ComplianceControl>;
  /** Threat category → controls a finding in it is evidence for. */
  findings: Record<ThreatCategoryKey, string[]>;
  /** Capability → controls it supports. */
  capabilities: Record<ComplianceCapability, string[]>;
}

const controls = (list: [string, string, string][]): Record<string, ComplianceControl> =>
  Object.fromEntries(list.map(([id, name, citation]) => [id, { id, name, citation }]));

const EU_AI_ACT: ComplianceFramework = {
  id: "eu-ai-act",
  name: "EU AI Act",
  edition: "Regulation (EU) 2024/1689",
  controls: controls([
    ["Art. 9", "Risk management system", "Regulation (EU) 2024/1689, Article 9"],
    ["Art. 10", "Data and data governance", "Regulation (EU) 2024/1689, Article 10"],
    ["Art. 12", "Record-keeping (automatic logging of events)", "Regulation (EU) 2024/1689, Article 12"],
    ["Art. 14", "Human oversight", "Regulation (EU) 2024/1689, Article 14"],
    ["Art. 15", "Accuracy, robustness and cybersecurity", "Regulation (EU) 2024/1689, Article 15 (incl. 15(5): resilience against attempts to alter use, outputs or performance by exploiting vulnerabilities)"],
    ["Art. 26(5)", "Deployer monitoring of operation", "Regulation (EU) 2024/1689, Article 26(5)"],
    ["Art. 26(6)", "Deployer keeps automatically generated logs (at least six months)", "Regulation (EU) 2024/1689, Article 26(6)"],
    ["Art. 72", "Post-market monitoring", "Regulation (EU) 2024/1689, Article 72"],
  ]),
  findings: {
    directInjection: ["Art. 15", "Art. 9"],
    indirectInjection: ["Art. 15", "Art. 9"],
    promptLeak: ["Art. 15"],
    toolPoisoning: ["Art. 15", "Art. 9"],
    rugPull: ["Art. 15", "Art. 9"],
    dataLeak: ["Art. 10", "Art. 15"],
    excessiveAgency: ["Art. 14", "Art. 9"],
    consumption: ["Art. 15"],
  },
  capabilities: {
    auditLog: ["Art. 12", "Art. 26(6)"],
    humanApproval: ["Art. 14"],
    accessControl: ["Art. 9", "Art. 14"],
    supplyChain: ["Art. 15", "Art. 9"],
    dataMasking: ["Art. 10"],
    monitoring: ["Art. 26(5)", "Art. 72", "Art. 15"],
  },
};

const ISO_42001: ComplianceFramework = {
  id: "iso42001",
  name: "ISO/IEC 42001",
  edition: "ISO/IEC 42001:2023, Annex A",
  controls: controls([
    ["A.4.5", "System and computing resources", "ISO/IEC 42001:2023, Annex A, A.4.5"],
    ["A.6.2.6", "AI system operation and monitoring", "ISO/IEC 42001:2023, Annex A, A.6.2.6"],
    ["A.6.2.8", "AI system recording of event logs", "ISO/IEC 42001:2023, Annex A, A.6.2.8"],
    ["A.7.5", "Data provenance", "ISO/IEC 42001:2023, Annex A, A.7.5"],
    ["A.8.4", "Communication of incidents", "ISO/IEC 42001:2023, Annex A, A.8.4"],
    ["A.9.2", "Processes for responsible use of AI systems", "ISO/IEC 42001:2023, Annex A, A.9.2"],
    ["A.9.4", "Intended use of the AI system", "ISO/IEC 42001:2023, Annex A, A.9.4"],
    ["A.10.3", "Suppliers", "ISO/IEC 42001:2023, Annex A, A.10.3"],
  ]),
  findings: {
    directInjection: ["A.6.2.6"],
    indirectInjection: ["A.6.2.6"],
    promptLeak: ["A.6.2.6"],
    toolPoisoning: ["A.10.3", "A.6.2.6"],
    rugPull: ["A.10.3", "A.6.2.6"],
    dataLeak: ["A.9.2", "A.6.2.6"],
    excessiveAgency: ["A.9.4", "A.9.2"],
    consumption: ["A.4.5", "A.6.2.6"],
  },
  capabilities: {
    auditLog: ["A.6.2.8", "A.8.4"],
    humanApproval: ["A.9.2"],
    accessControl: ["A.9.4", "A.9.2"],
    supplyChain: ["A.10.3", "A.7.5"],
    dataMasking: ["A.9.2"],
    monitoring: ["A.6.2.6"],
  },
};

const SOC2: ComplianceFramework = {
  id: "soc2",
  name: "SOC 2",
  edition: "AICPA Trust Services Criteria (2017, revised points of focus 2022)",
  controls: controls([
    ["CC6.1", "Logical access security", "TSC CC6.1"],
    ["CC6.3", "Access based on roles and least privilege", "TSC CC6.3"],
    ["CC6.6", "Protection against threats from outside the system boundary", "TSC CC6.6"],
    ["CC6.7", "Restricted transmission and movement of information", "TSC CC6.7"],
    ["CC6.8", "Prevention and detection of unauthorized or malicious software", "TSC CC6.8"],
    ["CC7.1", "Detection of configuration changes and vulnerabilities", "TSC CC7.1"],
    ["CC7.2", "Monitoring of system components for anomalies", "TSC CC7.2"],
    ["CC7.3", "Evaluation of security events", "TSC CC7.3"],
    ["CC8.1", "Change management", "TSC CC8.1"],
    ["CC9.2", "Vendor and business partner risk", "TSC CC9.2"],
    ["A1.1", "Capacity management", "TSC A1.1"],
    ["C1.1", "Identification and protection of confidential information", "TSC C1.1"],
  ]),
  findings: {
    directInjection: ["CC6.6", "CC7.2"],
    indirectInjection: ["CC6.6", "CC7.2"],
    promptLeak: ["C1.1", "CC6.7"],
    toolPoisoning: ["CC6.8", "CC9.2"],
    rugPull: ["CC7.1", "CC8.1", "CC9.2"],
    dataLeak: ["CC6.7", "C1.1"],
    excessiveAgency: ["CC6.1", "CC6.3"],
    consumption: ["A1.1", "CC7.2"],
  },
  capabilities: {
    auditLog: ["CC7.2", "CC7.3"],
    humanApproval: ["CC6.1"],
    accessControl: ["CC6.1", "CC6.3"],
    supplyChain: ["CC9.2", "CC7.1", "CC8.1"],
    dataMasking: ["CC6.7", "C1.1"],
    monitoring: ["CC7.2", "CC6.6"],
  },
};

const NIST_AI_RMF: ComplianceFramework = {
  id: "nist-ai-rmf",
  name: "NIST AI RMF",
  edition: "NIST AI 100-1 (AI RMF 1.0)",
  controls: controls([
    ["GOVERN 3.2", "Roles and responsibilities for human-AI configurations and oversight", "NIST AI 100-1, GOVERN 3.2"],
    ["GOVERN 6.1", "Policies for AI risks from third-party entities", "NIST AI 100-1, GOVERN 6.1"],
    ["MEASURE 2.4", "Functionality and behavior monitored in production", "NIST AI 100-1, MEASURE 2.4"],
    ["MEASURE 2.7", "Security and resilience evaluated and documented", "NIST AI 100-1, MEASURE 2.7"],
    ["MEASURE 2.10", "Privacy risk examined and documented", "NIST AI 100-1, MEASURE 2.10"],
    ["MANAGE 2.4", "Mechanisms to supersede, disengage or deactivate", "NIST AI 100-1, MANAGE 2.4"],
    ["MANAGE 3.1", "Third-party AI risks monitored and controls applied", "NIST AI 100-1, MANAGE 3.1"],
    ["MANAGE 4.1", "Post-deployment monitoring plans implemented", "NIST AI 100-1, MANAGE 4.1"],
  ]),
  findings: {
    directInjection: ["MEASURE 2.7", "MANAGE 4.1"],
    indirectInjection: ["MEASURE 2.7", "MANAGE 4.1"],
    promptLeak: ["MEASURE 2.7"],
    toolPoisoning: ["MANAGE 3.1", "MEASURE 2.7"],
    rugPull: ["MANAGE 3.1", "GOVERN 6.1"],
    dataLeak: ["MEASURE 2.10", "MEASURE 2.7"],
    excessiveAgency: ["GOVERN 3.2", "MANAGE 2.4"],
    consumption: ["MEASURE 2.4"],
  },
  capabilities: {
    auditLog: ["MEASURE 2.4", "MANAGE 4.1"],
    humanApproval: ["GOVERN 3.2", "MANAGE 2.4"],
    accessControl: ["GOVERN 3.2"],
    supplyChain: ["GOVERN 6.1", "MANAGE 3.1"],
    dataMasking: ["MEASURE 2.10"],
    monitoring: ["MEASURE 2.4", "MANAGE 4.1"],
  },
};

export const COMPLIANCE_FRAMEWORKS: Record<ComplianceFrameworkId, ComplianceFramework> = {
  "eu-ai-act": EU_AI_ACT,
  iso42001: ISO_42001,
  soc2: SOC2,
  "nist-ai-rmf": NIST_AI_RMF,
};

export const COMPLIANCE_FRAMEWORK_IDS = Object.keys(COMPLIANCE_FRAMEWORKS) as ComplianceFrameworkId[];
