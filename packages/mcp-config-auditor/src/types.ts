export type Severity = "critical" | "high" | "medium" | "low";

export interface ConfigFinding {
  patternId: string;
  patternName: string;
  category: string;
  severity: Severity;
  /** OWASP MCP Top 10 identifier, for example MCP04:2025. */
  owasp: string;
  recommendation: string;
  server?: string;
  file?: string;
  line: number;
  column: number;
  match: string;
}

export interface ParsedServer {
  name: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  autoApprove: unknown;
}

export interface InventoryTool {
  name: string;
  description?: string;
}

export interface InventoryServer {
  name: string;
  tools: InventoryTool[];
}
