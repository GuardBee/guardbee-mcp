export type OwaspId =
  | "MCP01:2025"
  | "MCP02:2025"
  | "MCP03:2025"
  | "MCP04:2025"
  | "MCP05:2025"
  | "MCP06:2025"
  | "MCP07:2025"
  | "MCP08:2025"
  | "MCP09:2025"
  | "MCP10:2025";

export type Grade = "A" | "B" | "C" | "D" | "F";

export type Severity = "critical" | "high" | "medium" | "low";

export interface NormalizedFinding {
  patternId: string;
  patternName: string;
  severity: Severity;
  owasp: OwaspId;
  source: string;
  recommendation: string;
  file?: string;
  line?: number;
  column?: number;
  match: string;
  tools?: string[];
}

export interface OwaspBucket {
  id: OwaspId;
  title: string;
  findingCount: number;
  findings: NormalizedFinding[];
}

export interface OwaspReport {
  mode: "path" | "live" | "catalog";
  grade: Grade;
  score: number;
  scannedFiles?: number;
  toolCount?: number;
  totalFindings: number;
  byOwasp: OwaspBucket[];
  findings: NormalizedFinding[];
  durationMs: number;
  label: string;
}

export type ConnectionTarget =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "http"; url: string };
