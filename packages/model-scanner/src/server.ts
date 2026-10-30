import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanModelFile, scanDirectory } from "./scanner.js";
import { DANGEROUS_GLOBALS } from "./dangerousGlobals.js";
import { HfError, scanHfRepo } from "./hf.js";
import { RISKY_TF_OPS } from "./tensorflowScanner.js";
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
  serveStdio(() => {
    const server = new McpServer({
      name: "guardbee-model-scanner",
      version: "0.1.0",
    });
    instrumentServer(server, "model-scanner");
    registerTools(server);
    return server;
  });
}

/** This package's MCP tools on `server`; @guardbee/security-suite serves several packages' tools from one process this way. */
export function registerTools(server: McpServer): void {
  server.registerTool(
    "scan_file",
    {
      description: "Scan a single ML model file for supply-chain risks: dangerous Python globals reachable during pickle deserialization (os/subprocess/eval/socket/dill gadgets, inside PyTorch zip checkpoints, joblib dumps and NumPy object arrays too), a malformed or disguised .safetensors header, a Keras Lambda-layer RCE pattern in .h5/.keras files, a path-traversal external_data reference in .onnx files, malformed GGUF headers and chat templates that escape the Jinja sandbox or carry hidden instructions, and TensorFlow SavedModel/GraphDef/TFLite graphs that read or write files or call Python.",
      inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the model file (.pt, .pth, .ckpt, .pkl, .pickle, .bin, .dill, .joblib, .jbl, .npy, .npz, .safetensors, .h5, .hdf5, .keras, .onnx, .gguf, .pb, .pbtxt, .tflite)"),
      }),
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

  server.registerTool(
    "scan_directory",
    {
      description: "Recursively scan a directory for ML model files (.pt, .pth, .ckpt, .pkl, .pickle, .bin, .dill, .joblib, .jbl, .npy, .npz, .safetensors, .h5, .hdf5, .keras, .onnx, .gguf, .pb, .pbtxt, .tflite; a TensorFlow SavedModel directory through its saved_model.pb) and report supply-chain risks in each. Automatically skips node_modules, .git, venv, and other non-model directories.",
      inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the directory to scan"),
        maxFiles: z.number().int().positive().optional().describe("Maximum number of files to scan (default: 2000)"),
        include: z
          .array(z.string())
          .optional()
          .describe("Only scan files whose path contains one of these strings"),
        exclude: z
          .array(z.string())
          .optional()
          .describe("Skip files/dirs whose path contains one of these strings"),
      }),
    },
    async ({ path: dirPath, maxFiles, include, exclude }) => {
      const result = scanDirectory(dirPath, { maxFiles, include, exclude });
      return { content: [{ type: "text", text: formatFindings(result.findings, result.scannedFiles, result.durationMs) }] };
    }
  );

  server.registerTool(
    "scan_hf_repo",
    {
      description: "Scan every model file in a Hugging Face model repo at a pinned commit. The revision (branch, tag or commit sha, default main) is resolved to a commit sha and all files are read from it. Files over 256 MB are checked from their first 64 MB (and last 64 MB for zip containers), which hold the headers and pickle streams the checks read. Gated or private repos need HF_TOKEN in the server's environment.",
      inputSchema: z.object({
        repo: z.string().describe('Model repo id, e.g. "openai-community/gpt2"'),
        revision: z.string().optional().describe("Branch, tag or commit sha (default: main)"),
        maxFiles: z.number().int().positive().optional().describe("Maximum number of model files to fetch and scan (default: 200)"),
      }),
    },
    async ({ repo, revision, maxFiles }) => {
      try {
        const r = await scanHfRepo(repo, { revision, maxFiles });
        const header = [
          `Repo: ${r.repo} @ ${r.revision} → commit ${r.sha}`,
          `Model files: ${r.modelFiles.length}${r.notScanned.length ? ` (${r.notScanned.length} over maxFiles not scanned)` : ""}`,
          ...(r.partialFiles.length ? [`Large, checked from the first 64 MB (and a zip's last 64 MB): ${r.partialFiles.join(", ")}`] : []),
          "",
        ];
        return { content: [{ type: "text", text: header.join("\n") + formatFindings(r.findings, r.scannedFiles, r.durationMs) }] };
      } catch (e) {
        if (e instanceof HfError) return { content: [{ type: "text", text: `❌ ${e.message}` }], isError: true };
        throw e;
      }
    }
  );

  server.registerTool(
    "list_patterns",
    {
      description: "List every dangerous Python global (module.function) this scanner treats as a red flag when found referenced inside a pickled model file, grouped by risk category",
    },
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
      lines.push("[tensorflow graph ops] (SavedModel, GraphDef, TFLite Flex)");
      for (const [op, risk] of Object.entries(RISKY_TF_OPS)) lines.push(`  • ${op} (${risk.severity}${risk.whenAttr ? ", with a file/grpc URL" : ""})`);
      lines.push("");
      lines.push("Plus format-integrity checks for .safetensors (header validation, disguised-binary detection), .h5/.keras (Lambda-layer RCE heuristic), .onnx (external_data path traversal), .npy/.npz (object arrays, disguised pickles), .joblib (walks embedded arrays and nested pickles) and .gguf (header, tensor bounds, chat-template SSTI, hidden or injected instructions).");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
