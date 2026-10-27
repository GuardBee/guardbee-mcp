import { createHash } from "node:crypto";

/**
 * The parts of an MCP tool definition a caller relies on when it decides to
 * trust the tool. Shared by mcp-rug-pull-detector baselines and the proxy's
 * persistent pins, so a baseline taken in CI can seed the proxy.
 */
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

/** Deep-sorts object keys so JSON.stringify gives the same bytes whatever the key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** The definition as it is hashed and stored: missing fields as null. */
export function toolSnapshot(tool: ToolDefinition): ToolDefinition {
  return {
    name: tool.name,
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
  };
}

/**
 * SHA-256 of name, description, input/output schema and annotations. A server
 * flipping `destructiveHint` to look safer changes what a caller authorises as
 * much as a rewritten description does, so both change the hash.
 */
export function hashToolDefinition(tool: ToolDefinition): string {
  const canonical = canonicalJson({
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? null,
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
