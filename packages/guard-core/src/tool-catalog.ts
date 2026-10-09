import { DESCRIPTION_INJECTION_PATTERNS } from "./tool-poisoning.js";

export interface SurfaceHit {
  patternId: string;
  patternName: string;
  category: "description-injection" | "obfuscation";
  severity: "critical" | "high" | "medium";
  recommendation: string;
  owasp: "MCP03:2025";
  index: number;
  match: string;
}

export interface CatalogTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

export interface CatalogFinding {
  patternId: string;
  patternName: string;
  category: "description-injection" | "obfuscation" | "confused-deputy";
  severity: "critical" | "high" | "medium";
  owasp: "MCP03:2025";
  recommendation: string;
  server?: string;
  toolName: string;
  field: string;
  match: string;
}

const DESTRUCTIVE = /\b(?:deletes?|drops?|unlinks?|wipes?|overwrites?|executes?|exec|rm\s+-rf)\b/i;
const LATIN = /[A-Za-z]/;
const OTHER_SCRIPT = /[\u0370-\u03FF\u0400-\u04FF]/;

export function annotationContradicts(description: string): boolean {
  return DESTRUCTIVE.test(description);
}

/** Instruction and obfuscation hits inside one tool description, parameter description, or enum value. */
export function matchSurface(text: string): SurfaceHit[] {
  const hits: SurfaceHit[] = [];
  const capped = text.slice(0, 8000);

  for (const pattern of DESCRIPTION_INJECTION_PATTERNS) {
    const flags = pattern.pattern.flags.includes("g") ? pattern.pattern.flags : `${pattern.pattern.flags}g`;
    const re = new RegExp(pattern.pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(capped)) !== null) {
      hits.push({
        patternId: pattern.id,
        patternName: pattern.name,
        category: "description-injection",
        severity: pattern.severity,
        recommendation: pattern.recommendation,
        owasp: "MCP03:2025",
        index: match.index,
        match: match[0],
      });
      if (match.index === re.lastIndex) re.lastIndex++;
    }
  }

  // A lookalike hides inside one word ("Reаd" with a Cyrillic а). Whole words in
  // another script next to Latin ones ("заказов в формате JSON") are just a language.
  const mixedWord = /[\p{L}\p{M}]+/gu;
  let word: RegExpExecArray | null;
  let mixedAt = -1;
  while ((word = mixedWord.exec(capped)) !== null) {
    if (LATIN.test(word[0]) && OTHER_SCRIPT.test(word[0])) {
      mixedAt = word.index;
      break;
    }
  }
  if (mixedAt >= 0) {
    hits.push({
      patternId: "mixed_script_in_description",
      patternName: "A word in the description mixes Latin letters with Cyrillic or Greek lookalikes",
      category: "obfuscation",
      severity: "high",
      recommendation: "A description that mixes scripts can show a familiar word while the model reads a different identifier. Compare the raw characters, not the rendered glyphs.",
      owasp: "MCP03:2025",
      index: mixedAt,
      match: capped.slice(mixedAt, mixedAt + 8),
    });
  }

  const blob = /[A-Za-z0-9+/]{32,}={0,2}/g;
  let encoded: RegExpExecArray | null;
  while ((encoded = blob.exec(capped)) !== null) {
    if (!suspiciousBlob(encoded[0])) continue;
    hits.push({
      patternId: "encoded_blob_in_description",
      patternName: "Description contains a long encoded blob",
      category: "obfuscation",
      severity: "medium",
      recommendation: "A long base64-shaped token in a tool description is a common way to hide an instruction from a quick review. Decode it before trusting the server.",
      owasp: "MCP03:2025",
      index: encoded.index,
      match: encoded[0].slice(0, 24),
    });
    if (encoded.index === blob.lastIndex) blob.lastIndex++;
  }

  return hits;
}

function suspiciousBlob(token: string): boolean {
  if (token.length < 32) return false;
  const hasUpper = /[A-Z]/.test(token);
  const hasLower = /[a-z]/.test(token);
  const hasDigit = /\d/.test(token);
  return (hasUpper && hasLower) || hasDigit || token.includes("+") || token.includes("/");
}

export function scanToolCatalog(tools: CatalogTool[], server?: string): CatalogFinding[] {
  const findings: CatalogFinding[] = [];

  for (const tool of tools) {
    const texts: Array<{ field: string; text: string }> = [];
    if (tool.description) texts.push({ field: "description", text: tool.description });
    for (const entry of schemaTexts(tool.inputSchema)) {
      if (entry.text === tool.description) continue;
      texts.push(entry);
    }

    for (const entry of texts) {
      for (const hit of matchSurface(entry.text)) {
        findings.push({
          patternId: hit.patternId,
          patternName: hit.patternName,
          category: hit.category,
          severity: hit.severity,
          owasp: "MCP03:2025",
          recommendation: hit.recommendation,
          server,
          toolName: tool.name,
          field: entry.field,
          match: `${tool.name} ${entry.field}: ${hit.match}`.slice(0, 240),
        });
      }
    }

    if (readOnlyHint(tool.annotations) && tool.description && annotationContradicts(tool.description)) {
      findings.push({
        patternId: "annotation_readonly_lie",
        patternName: `Tool "${tool.name}" is annotated read-only but its description says it mutates or executes`,
        category: "confused-deputy",
        severity: "high",
        owasp: "MCP03:2025",
        recommendation: "readOnlyHint: true tells a client this tool will not change state. A description that deletes, drops, or executes contradicts that annotation. The handler is not required for this check — the published definition already disagrees with itself.",
        server,
        toolName: tool.name,
        field: "annotations.readOnlyHint",
        match: tool.description.slice(0, 240),
      });
    }
  }

  return findings;
}

function readOnlyHint(annotations: unknown): boolean {
  if (!annotations || typeof annotations !== "object") return false;
  return (annotations as { readOnlyHint?: unknown }).readOnlyHint === true;
}

function schemaTexts(schema: unknown): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  walkSchema(schema, "inputSchema", out);
  return out;
}

function walkSchema(node: unknown, path: string, out: Array<{ field: string; text: string }>): void {
  if (!node || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.description === "string") out.push({ field: `${path}.description`, text: rec.description });
  if (Array.isArray(rec.enum)) {
    rec.enum.forEach((item, index) => {
      if (typeof item === "string") out.push({ field: `${path}.enum[${index}]`, text: item });
    });
  }
  if (rec.properties && typeof rec.properties === "object") {
    for (const [key, child] of Object.entries(rec.properties as Record<string, unknown>)) {
      walkSchema(child, `${path}.${key}`, out);
    }
  }
}
