import { createHash } from "crypto";
import type { ToolSnapshot } from "./types.js";

/** Deep-sorts object keys so JSON.stringify produces the same bytes regardless of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Hashes everything a caller actually relies on when deciding to trust a tool:
 * name, description, input/output schema, and annotations (readOnlyHint,
 * destructiveHint, ...). A server flipping `destructiveHint` from true to
 * false to look safer is just as much a rug pull as rewriting the
 * description — both change what a caller believes they're authorizing.
 */
export function hashTool(tool: ToolSnapshot): string {
  const canonical = canonicalJson({
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? null,
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function serverIdFromTarget(target: string): string {
  return createHash("sha256").update(target, "utf8").digest("hex").slice(0, 16);
}
