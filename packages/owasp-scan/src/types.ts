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

export interface FileCoverage {
  file: string;
  /** typescript, javascript, python, go, rust, java, … */
  language: string;
  /** full: tool definitions, handler sinks and OAuth rules; patterns: language-neutral rules only. */
  analysis: "full" | "patterns";
  /** MCP tool definitions found in the file. */
  tools: number;
}

export interface LanguageCoverage {
  language: string;
  analysis: "full" | "patterns";
  files: number;
  tools: number;
}

export interface ScanCoverage {
  languages: LanguageCoverage[];
  files: FileCoverage[];
}

/** One server found in a client config during an `installed` scan, and what happened to it. */
export interface InstalledServer {
  /** Clients whose configs list this server (one entry per client, e.g. cursor, claude-code:/repo). */
  clients: string[];
  configPaths: string[];
  name: string;
  transport: "stdio" | "http";
  /** scanned: tools/list was read; skipped: not contacted (disabled, or a local server without --run-stdio); error: contact failed. */
  status: "scanned" | "skipped" | "error";
  reason?: string;
  toolCount?: number;
  serverInfo?: { name: string; version: string };
  /** Tool definitions changed since the pin stored on an earlier run. */
  drift?: number;
}

export interface OwaspReport {
  mode: "path" | "live" | "catalog" | "installed";
  grade: Grade;
  score: number;
  scannedFiles?: number;
  /** Source languages of a path scan and how deeply each file was analyzed. */
  coverage?: ScanCoverage;
  toolCount?: number;
  totalFindings: number;
  byOwasp: OwaspBucket[];
  findings: NormalizedFinding[];
  durationMs: number;
  label: string;
  /**
   * Top 10 ids that were not run in this pass (e.g. MCP04 without
   * `--with-supply-chain`, MCP06 without `--with-content`). Empty when every
   * category the path scan can cover was attempted.
   */
  notRun?: OwaspId[];
  /** `installed` mode: every server found in the machine's client configs. */
  servers?: InstalledServer[];
}

export type ConnectionTarget =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | {
      type: "http";
      url: string;
      /** Headers from the client config (e.g. Authorization), sent on every request. */
      headers?: Record<string, string>;
      /** streamable (default for `live`), sse (legacy), or auto: Streamable HTTP first, then SSE. */
      transport?: "streamable" | "sse" | "auto";
    };
