export interface Finding {
  code: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  recommendation: string;
}

export function mkFinding(
  code: string,
  message: string,
  severity: Finding["severity"],
  recommendation: string
): Finding {
  return { code, message, severity, recommendation };
}

export interface ProbeOutcome {
  /** Whether this endpoint fingerprinted as the store type this probe checks for. */
  matched: boolean;
  findings: Finding[];
  detail?: Record<string, unknown>;
}
