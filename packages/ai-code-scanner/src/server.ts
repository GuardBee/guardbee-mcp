import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanText, scanFile, scanDirectory } from "./scanner.js";
import { AI_CODE_PATTERNS, type AiCodePattern } from "./patterns.js";
import { loadCustomPatterns } from "./custom-patterns.js";
import { loadConfig } from "./config.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No AI/LLM security issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const lines: string[] = [
    `⚠️  Found ${findings.length} AI/LLM security issue(s) in ${scannedFiles} file(s) (${durationMs}ms)`,
    `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}  Low: ${bySeverity.low}`,
    "",
  ];

  for (const f of findings) {
    const loc = f.file ? `${f.file}:${f.line}:${f.column}` : `line ${f.line}:${f.column}`;
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.category})`);
    lines.push(`  Location       : ${loc}`);
    lines.push(`  Match          : ${f.match}`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Loads built-in + custom patterns once at server startup, from a rules dir
 * resolved against the process's cwd (the MCP client launches this server
 * with the project root as cwd). Scan tools take arbitrary target paths, so
 * this can't be redone per-call the way the CLI resolves it per scan target.
 */
function loadServerPatterns(): { patterns: AiCodePattern[]; customCount: number; rulesDir?: string } {
  const cfg = loadConfig(process.cwd());
  if (!cfg.rulesDir) return { patterns: AI_CODE_PATTERNS, customCount: 0 };

  const { patterns: custom, errors } = loadCustomPatterns(cfg.rulesDir);
  for (const e of errors) process.stderr.write(`[guardbee-ai-code-scanner] ${e}\n`);
  return {
    patterns: [...AI_CODE_PATTERNS, ...custom],
    customCount: custom.length,
    rulesDir: cfg.rulesDir,
  };
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-ai-code-scanner",
    version: "0.1.0",
  });
  instrumentServer(server, "ai-code-scanner");

  const { patterns, customCount, rulesDir } = loadServerPatterns();
  if (customCount > 0) {
    process.stderr.write(`[guardbee-ai-code-scanner] Loaded ${customCount} custom rule(s) from ${rulesDir}\n`);
  }

  server.tool(
    "scan_text",
    "Scan a text string or code snippet for insecure AI/LLM integration patterns (client-exposed keys, unsafe output handling, excessive agent tool permissions, PII sent to a model, prompt injection surface).",
    {
      content: z.string().describe("The code content to scan"),
      label: z.string().optional().describe("Optional label shown in findings (e.g. filename)"),
    },
    async ({ content, label }) => {
      const findings = scanText(content, label, patterns);
      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_file",
    "Scan a single file for insecure AI/LLM integration patterns",
    {
      path: z.string().describe("Absolute or relative path to the file to scan"),
    },
    async ({ path: filePath }) => {
      const { findings, skipped } = scanFile(filePath, patterns);

      if (skipped) {
        return {
          content: [{ type: "text", text: `⏭️  File skipped (binary, too large, or unreadable): ${filePath}` }],
        };
      }

      return { content: [{ type: "text", text: formatFindings(findings, 1, 0) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Recursively scan a directory for insecure AI/LLM integration patterns. Automatically skips node_modules, .git, dist, and binary files.",
    {
      path: z.string().describe("Absolute or relative path to the directory to scan"),
      maxFiles: z.number().int().positive().optional().describe("Maximum number of files to scan (default: 5000)"),
      include: z
        .array(z.string())
        .optional()
        .describe("Only scan files whose path contains one of these strings (e.g. [\".ts\", \"src/agents\"])"),
      exclude: z
        .array(z.string())
        .optional()
        .describe("Skip files/dirs whose path contains one of these strings"),
    },
    async ({ path: dirPath, maxFiles, include, exclude }) => {
      const result = scanDirectory(dirPath, { maxFiles, include, exclude, patterns });
      return { content: [{ type: "text", text: formatFindings(result.findings, result.scannedFiles, result.durationMs) }] };
    }
  );

  server.tool(
    "list_patterns",
    "List all AI/LLM security patterns that the scanner can detect, grouped by category (including any custom rules loaded from .guardbee/rules)",
    {},
    async () => {
      const builtinIds = new Set(AI_CODE_PATTERNS.map((p) => p.id));
      const lines = ["Supported AI/LLM security patterns:\n"];
      const byCategory = new Map<string, AiCodePattern[]>();
      for (const p of patterns) {
        const list = byCategory.get(p.category) ?? [];
        list.push(p);
        byCategory.set(p.category, list);
      }
      for (const [category, list] of byCategory) {
        lines.push(`[${category}]`);
        for (const p of list) {
          const origin = builtinIds.has(p.id) ? "" : " (custom)";
          lines.push(`  • ${p.name} (${p.id}, ${p.severity})${origin}`);
        }
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
