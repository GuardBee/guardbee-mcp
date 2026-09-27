import type { InterceptResult } from "../types.js";
import { scanForPromptInjection } from "./prompt-injection.js";

/** Same patterns as request scanning, applied to a tool result the model will read. */
export function scanToolResult(content: unknown, mode: "block" | "warn" = "block"): InterceptResult {
  const result = scanForPromptInjection(content, mode);
  if (result.action === "allow") return result;
  return {
    action: result.action,
    reason: `Indirect prompt injection in tool result (MCP06:2025): ${result.reason}`,
  };
}
