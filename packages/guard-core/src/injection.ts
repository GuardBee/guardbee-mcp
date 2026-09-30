export type ScanResult =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "warn"; reason: string };

// Common prompt injection patterns
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /you\s+are\s+now\s+(a\s+)?(?!an?\s+AI|a\s+language)/i,
  /act\s+as\s+(if\s+you\s+are\s+)?(?!an?\s+AI|a\s+language)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(?!an?\s+AI|a\s+language)/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /developer\s+mode/i,
  /system\s+prompt\s*:/i,
  /<\s*system\s*>/i,
  /\[SYSTEM\]/i,
  /bypass\s+(safety|filter|restriction|policy)/i,
  /override\s+(safety|filter|restriction|policy)/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions|prompt)/i,
  /print\s+(your\s+)?(system\s+prompt|instructions)/i,
];

function flattenValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value ?? "");
}

export function scanForPromptInjection(
  input: unknown,
  mode: "block" | "warn" = "block",
): ScanResult {
  const text = flattenValue(input);

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        action: mode,
        reason: `Prompt injection pattern detected: ${pattern.toString()}`,
      };
    }
  }

  return { action: "allow" };
}

/** Same patterns as request scanning, applied to a tool result the model will read. */
export function scanToolResult(content: unknown, mode: "block" | "warn" = "block"): ScanResult {
  const result = scanForPromptInjection(content, mode);
  if (result.action === "allow") return result;
  return {
    action: result.action,
    reason: `Indirect prompt injection in tool result (MCP06:2025): ${result.reason}`,
  };
}
