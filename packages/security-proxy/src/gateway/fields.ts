import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const MASKED = "[MASKED]";

function blankKeys(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => blankKeys(item, fields));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, fields.has(key.toLowerCase()) ? MASKED : blankKeys(v, fields)]),
    );
  }
  return value;
}

/** A text item that holds JSON (as most DB and API tools return) is parsed, blanked and re-serialized. */
function blankText(text: string, fields: ReadonlySet<string>): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return text;
  }
  return JSON.stringify(blankKeys(parsed, fields), null, trimmed.includes("\n") ? 2 : undefined);
}

/**
 * Replace the values of the named keys with `[MASKED]` — in JSON text content
 * and in structuredContent. Key names compare case-insensitively.
 */
export function maskFields(result: CallToolResult, fieldNames: readonly string[]): CallToolResult {
  const fields = new Set(fieldNames.map((name) => name.toLowerCase()));
  if (fields.size === 0) return result;
  return {
    ...result,
    content: result.content.map((item) => (item.type === "text" ? { ...item, text: blankText(item.text, fields) } : item)),
    ...(result.structuredContent
      ? { structuredContent: blankKeys(result.structuredContent, fields) as Record<string, unknown> }
      : {}),
  };
}
