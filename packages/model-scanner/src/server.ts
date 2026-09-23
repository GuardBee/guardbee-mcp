import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanModelFile, scanDirectory } from "./scanner.js";
import { DANGEROUS_GLOBALS } from "./dangerousGlobals.js";
import type { Finding } from "./scanner.js";

function formatFindings(findings: Finding[], scannedFiles: number, durationMs: number): string {
  if (findings.length === 0) {
    return `✅ No model-file security issues found. Scanned ${scannedFiles} file(s) in ${durationMs}ms.`;
  }

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity]++;

  const lines: string[] = [
    `⚠️  Found ${findings.length} model-file security issue(s) in ${scannedFiles} file(s) (${durationMs}ms)`,
    `   Critical: ${bySeverity.critical}  High: ${bySeverity.high}  Medium: ${bySeverity.medium}  Low: ${bySeverity.low}`,
    "",
  ];

  for (const f of findings) {
    const loc = f.file ? f.file : "input";
    lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.category})`);
    lines.push(`  File           : ${loc}`);
    if (f.match) lines.push(`  Match          : ${f.match}`);
    if (f.context) lines.push(`  Context        : ${f.context}`);
    lines.push(`  Recommendation : ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-model-scanner",
    version: "0.1.0",
  });
  instrumentServer(server, "model-scanner");

  server.tool(
    "scan_file",
    "Scan a single ML model file for supply-chain risks: dangerous Python globals reachable during pickle deserialization (os/subprocess/eval/socket/etc, including inside PyTorch's zip checkpoint container), a malformed or disguised .safetensors header, a Keras Lambda-layer RCE pattern in .h5/.keras files, or a path-traversal external_data reference in .onnx files.",
    {
      path: z.string().describe("Absolute or relative path to the model file (.pt, .pth, .ckpt, .pkl, .pickle, .bin, .safetensors, .h5, .hdf5, .keras, .onnx)"),
    },
    async ({ path: filePath }) => {
      const { findings, skipped, format } = scanModelFile(filePath);

      if (skipped) {
        return {
          content: [{ type: "text", text: `⏭️  File skipped (unsupported extension, empty, unreadable, or not a recognized model format): ${filePath}` }],
        };
      }

      return { content: [{ type: "text", text: `Format detected: ${format}\n\n${formatFindings(findings, 1, 0)}` }] };
    }
  );

  server.tool(
    "scan_directory",
    "Recursively scan a directory for ML model files (.pt, .pth, .ckpt, .pkl, .pickle, .bin, .safetensors, .h5, .hdf5, .keras, .onnx) and report supply-chain risks in each. Automatically skips node_modules, .git, venv, and other non-model directories.",
    {
      path: z.string().describe("Absolute or relative path to the directory to scan"),
      maxFiles: z.number().optional().describe("Maximum number of files to scan (default: 2000)"),
      include: z
        .array(z.string())
        .optional()
        .describe("Only scan files whose path contains one of these strings"),
      exclude: z
        .array(z.string())
        .optional()
        .describe("Skip files/dirs whose path contains one of these strings"),
    },
    async ({ path: dirPath, maxFiles, include, exclude }) => {
      const result = scanDirectory(dirPath, { maxFiles, include, exclude });
      return { content: [{ type: "text", text: formatFindings(result.findings, result.scannedFiles, result.durationMs) }] };
    }
  );

  server.tool(
    "list_patterns",
    "List every dangerous Python global (module.function) this scanner treats as a red flag when found referenced inside a pickled model file, grouped by risk category",
    {},
    async () => {
      const lines = ["Dangerous globals catalog (pickle deserialization):\n"];
      const byCategory = new Map<string, typeof DANGEROUS_GLOBALS>();
      for (const g of DANGEROUS_GLOBALS) {
        const list = byCategory.get(g.category) ?? [];
        list.push(g);
        byCategory.set(g.category, list);
      }
      for (const [category, globals] of byCategory) {
        lines.push(`[${category}]`);
        for (const g of globals) lines.push(`  • ${g.module}.${g.name === "*" ? "*" : g.name} (${g.severity})`);
        lines.push("");
      }
      lines.push("Plus format-integrity checks for .safetensors (header validation, disguised-binary detection), .h5/.keras (Lambda-layer RCE heuristic), and .onnx (external_data path traversal).");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
