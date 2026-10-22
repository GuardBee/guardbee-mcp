import { createHash } from "crypto";
import { hashToolDefinition } from "@guardbee/guard-core";
import type { ToolSnapshot } from "./types.js";

// The same bytes the proxy's persistent pins use (guard-core), so a baseline taken here can seed it
export { canonicalJson } from "@guardbee/guard-core";

export function hashTool(tool: ToolSnapshot): string {
  return hashToolDefinition(tool);
}

export function serverIdFromTarget(target: string): string {
  return createHash("sha256").update(target, "utf8").digest("hex").slice(0, 16);
}
