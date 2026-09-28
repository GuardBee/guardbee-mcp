import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { scanNpm, scanPip, checkSinglePackage } from "./scanner.js";
import type { Finding, ScanResult } from "./scanner.js";

function formatReport(result: ScanResult): string {
  if (result.findings.length === 0) {
    return `✅ All ${result.packagesChecked} ${result.ecosystem} dependenc${result.packagesChecked === 1 ? "y" : "ies"} exist on the real registry, none suspiciously new (${result.durationMs}ms).`;
  }

  const critical = result.findings.filter((f) => f.severity === "critical");
  const low = result.findings.filter((f) => f.severity === "low");

  const lines: string[] = [
    `⚠️  ${result.findings.length} finding(s) across ${result.packagesChecked} ${result.ecosystem} dependencies (${result.durationMs}ms)`,
    `   Critical (does not exist): ${critical.length}  Low (recently published): ${low.length}`,
    "",
  ];

  for (const f of [...critical, ...low]) {
    const icon = f.severity === "critical" ? "🔴" : "⚪";
    lines.push(`${icon} [${f.severity.toUpperCase()}] ${f.packageName}${f.isDev ? " (dev)" : ""} — ${f.patternName}`);
    lines.push(`   ${f.recommendation}`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatSingle(finding: Finding | null, name: string, ecosystem: string): string {
  if (!finding) return `✅ ${name} exists on ${ecosystem} and isn't suspiciously new.`;
  const icon = finding.severity === "critical" ? "🔴" : "⚪";
  return `${icon} [${finding.severity.toUpperCase()}] ${finding.patternName}\n${finding.recommendation}`;
}

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-slopsquat-scanner",
    version: "0.1.0",
  });
  instrumentServer(server, "slopsquat-scanner");

  server.tool(
    "scan_npm",
    "Check every dependency declared in a package.json (dependencies, devDependencies, peerDependencies, optionalDependencies) against the real npm registry -- flags any package name that doesn't exist at all (a likely LLM-hallucinated dependency an attacker may have pre-registered, i.e. 'slopsquatting'), and separately notes any that exist but were only first published very recently.",
    {
      directory: z.string().describe("Path to the directory containing package.json"),
    },
    async ({ directory }) => {
      const result = await scanNpm(directory);
      if (result.packagesChecked === 0) {
        return { content: [{ type: "text", text: `No package.json found (or no dependencies) in ${directory}` }] };
      }
      return { content: [{ type: "text", text: formatReport(result) }] };
    }
  );

  server.tool(
    "scan_pip",
    "Check every dependency declared in requirements.txt or pyproject.toml against the real PyPI registry -- flags any package name that doesn't exist at all (a likely LLM-hallucinated dependency an attacker may have pre-registered), and separately notes any that exist but were only first published very recently.",
    {
      directory: z.string().describe("Path to the directory containing requirements.txt or pyproject.toml"),
    },
    async ({ directory }) => {
      const result = await scanPip(directory);
      if (result.packagesChecked === 0) {
        return { content: [{ type: "text", text: `No requirements.txt or pyproject.toml found in ${directory}` }] };
      }
      return { content: [{ type: "text", text: formatReport(result) }] };
    }
  );

  server.tool(
    "check_package",
    "Check a single package name against the real npm or PyPI registry",
    {
      name: z.string().describe("Package name"),
      ecosystem: z.enum(["npm", "PyPI"]).describe("Which registry to check"),
    },
    async ({ name, ecosystem }) => {
      const finding = await checkSinglePackage(name, ecosystem);
      return { content: [{ type: "text", text: formatSingle(finding, name, ecosystem) }] };
    }
  );

  server.tool(
    "scan_directory",
    "Auto-detect and check both npm and pip manifests (package.json, requirements.txt, pyproject.toml) in a directory against their real registries",
    {
      directory: z.string().describe("Path to the project root directory"),
    },
    async ({ directory }) => {
      const [npm, pip] = await Promise.all([scanNpm(directory), scanPip(directory)]);
      const lines: string[] = [];

      if (npm.packagesChecked > 0) {
        lines.push("── npm ─────────────────────────────────────────");
        lines.push(formatReport(npm));
      }
      if (pip.packagesChecked > 0) {
        lines.push("── pip ─────────────────────────────────────────");
        lines.push(formatReport(pip));
      }
      if (lines.length === 0) {
        return { content: [{ type: "text", text: `No supported manifest files found in ${directory}` }] };
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
