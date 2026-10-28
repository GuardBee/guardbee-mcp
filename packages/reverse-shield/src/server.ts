import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { applyIgnores, compareToBaseline, readBaseline } from "./baseline.js";
import type { BaselineDiff } from "./baseline.js";
import { formatFixReport, suggestFixes } from "./fixes.js";
import { scanUrl } from "./live.js";
import { RULES } from "./rules.js";
import { scanPath } from "./scanner.js";
import type { ScanResult } from "./scanner.js";

export function formatResult(result: ScanResult, diff?: BaselineDiff): string {
  const lines: string[] = [];
  if (diff) {
    lines.push(`Compared to baseline (grade ${diff.previousGrade} → ${result.grade}): ${diff.added.length} new, ${diff.fixed.length} fixed, ${diff.unchanged.length} unchanged`);
    for (const fp of diff.fixed) lines.push(`  fixed: ${fp.split("|").slice(0, 2).join(" ")}`);
    lines.push("");
  }
  const kinds = result.kinds.length > 0 ? result.kinds.join(", ") : "nothing recognised";
  if (result.findings.length === 0) {
    lines.push(`✅ Grade ${result.grade} — nothing handed to a reverse engineer for free. ${result.scannedFiles} file(s) checked (${kinds}) in ${result.durationMs}ms.`);
  } else {
    const count = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of result.findings) count[f.severity]++;
    lines.push(`🛡️  Reverse-engineering resistance: grade ${result.grade} — ${result.findings.length} finding(s) in ${result.scannedFiles} file(s) (${kinds}, ${result.durationMs}ms)`);
    lines.push(`   Critical: ${count.critical}  High: ${count.high}  Medium: ${count.medium}  Low: ${count.low}`);
    lines.push("");
    for (const f of result.findings) {
      lines.push(`[${f.severity.toUpperCase()}] ${f.patternName} (${f.target}/${f.category})`);
      if (f.file) lines.push(`  Where          : ${f.file}${f.line > 1 ? `:${f.line}:${f.column}` : ""}`);
      if (f.match) lines.push(`  Evidence       : ${f.match}`);
      lines.push(`  Gives away     : ${f.context}`);
      lines.push(`  Fix            : ${f.recommendation}`);
      lines.push("");
    }
  }
  if (result.notes.length > 0) {
    lines.push("Notes:");
    for (const n of result.notes) lines.push(`  • ${n}`);
  }
  return lines.join("\n");
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-reverse-shield",
    version: "0.1.0",
  });
  instrumentServer(server, "reverse-shield");
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** The package's tools, also served by @guardbee/security-suite under its own prefix. */
export function registerTools(server: McpServer): void {
  server.tool(
    "scan_artifact",
    "Audit a shipped build artifact for how easily it can be reverse engineered — the defensive counterpart to reverse-engineering MCPs. Accepts an APK, an Electron app (.app bundle, app folder or app.asar), a macOS/Linux/Windows binary (Mach-O, ELF, PE, .NET assembly), a JavaScript bundle or source map, or a build output directory containing any of these. Reports shipped source maps and source code, missing minification/R8/.NET obfuscation, debug info and unstripped symbols, debuggable flags and entitlements, Electron fuses that allow Node/inspector/ASAR tampering, missing code signing, embedded credentials and internal hosts, with an A–F grade.",
    {
      path: z.string().describe("Absolute or relative path to the artifact or build output directory"),
      maxFiles: z.number().int().positive().optional().describe("Maximum number of files to check in a directory (default: 5000)"),
      include: z.array(z.string()).optional().describe("Only check files whose path contains one of these strings"),
      exclude: z.array(z.string()).optional().describe("Skip files/dirs whose path contains one of these strings"),
      ignore: z.array(z.string()).optional().describe("Accepted findings to leave out: a rule id, or rule:path-substring (e.g. bundle_secret:firebase-config.js)"),
      baseline: z.string().optional().describe("Path to a baseline written by `guardbee-reverse-shield scan --update-baseline`; the report then lists new and fixed findings"),
    },
    async ({ path, maxFiles, include, exclude, ignore, baseline }) => {
      try {
        const result = scanPath(path, { maxFiles, include, exclude });
        applyIgnores(result, ignore ?? []);
        const diff = baseline ? compareToBaseline(result, readBaseline(baseline)) : undefined;
        return { content: [{ type: "text", text: formatResult(result, diff) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
      }
    },
  );

  server.tool(
    "scan_url",
    "Check a live website the way an analyst starts: fetch the page, read its same-site JavaScript bundles, follow sourceMappingURL comments and try <bundle>.map even when the comment was stripped. Reports publicly downloadable source maps (and whether they embed the original sources), unminified or development bundles, embedded credentials and internal hosts. Third-party scripts are not fetched.",
    {
      url: z.string().url().describe("Page URL (http or https)"),
      maxScripts: z.number().int().positive().max(100).optional().describe("Maximum number of same-site scripts to fetch (default: 25)"),
    },
    async ({ url, maxScripts }) => {
      try {
        return { content: [{ type: "text", text: formatResult(await scanUrl(url, { maxScripts })) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
      }
    },
  );

  server.tool(
    "suggest_fixes",
    "Read a project's build configuration (Vite, webpack, Next.js, Angular, Create React App, Android Gradle and manifest, React Native, electron-builder / Forge, .NET project files, Flutter) and propose the changes that close what scan_artifact reports: hidden source maps, minification, R8, debuggable and backup flags, Hermes, Electron fuses and ASAR, no embedded PDB. Returns unified diffs to review and apply (git apply); it never modifies files.",
    {
      projectPath: z.string().describe("Project source directory (not the build output)"),
    },
    async ({ projectPath }) => {
      try {
        return { content: [{ type: "text", text: formatFixReport(suggestFixes(projectPath)) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
      }
    },
  );

  server.tool(
    "list_checks",
    "List every reverse-engineering resistance check, grouped by target (web, electron, android, ios, native, dotnet, framework), with what each finding gives away and how to fix it",
    {},
    async () => {
      const lines = ["Reverse-engineering resistance checks:\n"];
      for (const target of ["web", "electron", "android", "ios", "native", "dotnet", "framework"] as const) {
        lines.push(`[${target}]`);
        for (const r of RULES.filter((rule) => rule.target === target)) {
          lines.push(`  • ${r.id} (${r.severity}, ${r.category}) — ${r.name}`);
          lines.push(`      gives away: ${r.exposes}`);
        }
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
