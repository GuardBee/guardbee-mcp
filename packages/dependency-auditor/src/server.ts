import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { parseNpmManifest } from "./parsers/npm.js";
import { parsePipRequirements } from "./parsers/pip.js";
import { queryOsvBatch, type Ecosystem } from "./osv.js";
import { formatReport } from "./report.js";

export async function startServer() {
  const server = new McpServer({
    name: "guardbee-dependency-auditor",
    version: "0.1.0",
  });
  instrumentServer(server, "dependency-auditor");

  server.tool(
    "audit_npm",
    "Audit npm dependencies for known CVEs using the OSV database. Reads exact versions from package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock (v1 and berry) or bun.lock, falling back to package.json ranges",
    {
      directory: z.string().describe("Path to the directory containing package.json"),
      includeDevDeps: z
        .boolean()
        .optional()
        .describe("Include devDependencies in the audit (default: false)"),
    },
    async ({ directory, includeDevDeps = false }) => {
      const start = Date.now();
      let deps = parseNpmManifest(directory);

      if (deps.length === 0) {
        return {
          content: [{ type: "text", text: `No package.json found or no dependencies in ${directory}` }],
        };
      }

      if (!includeDevDeps) deps = deps.filter((d) => !d.isDev);

      const packages = deps.map((d) => ({ name: d.name, version: d.version, ecosystem: "npm" as Ecosystem }));
      const results = await queryOsvBatch(packages);
      const report = formatReport(results, "npm", Date.now() - start);

      return { content: [{ type: "text", text: report }] };
    }
  );

  server.tool(
    "audit_pip",
    "Audit Python dependencies for known CVEs using the OSV database. Reads exact versions from uv.lock, poetry.lock or Pipfile.lock, falling back to requirements.txt / pyproject.toml",
    {
      directory: z.string().describe("Path to the directory containing requirements.txt or pyproject.toml"),
      includeDevDeps: z
        .boolean()
        .optional()
        .describe("Include dev groups from poetry.lock, uv.lock or Pipfile.lock (default: false)"),
    },
    async ({ directory, includeDevDeps = false }) => {
      const start = Date.now();
      let deps = parsePipRequirements(directory);
      if (!includeDevDeps) deps = deps.filter((d) => !d.isDev);

      if (deps.length === 0) {
        return {
          content: [{ type: "text", text: `No requirements.txt or pyproject.toml found in ${directory}` }],
        };
      }

      const packages = deps.map((d) => ({ name: d.name, version: d.version, ecosystem: "PyPI" as Ecosystem }));
      const results = await queryOsvBatch(packages);
      const report = formatReport(results, "pip", Date.now() - start);

      return { content: [{ type: "text", text: report }] };
    }
  );

  server.tool(
    "audit_package",
    "Audit a single package by name, version, and ecosystem",
    {
      name: z.string().describe("Package name"),
      version: z.string().describe("Package version (e.g. 1.2.3)"),
      ecosystem: z
        .enum(["npm", "PyPI", "crates.io", "Maven", "Go", "RubyGems"])
        .describe("Package ecosystem"),
    },
    async ({ name, version, ecosystem }) => {
      const start = Date.now();
      const results = await queryOsvBatch([{ name, version, ecosystem: ecosystem as Ecosystem }]);
      const report = formatReport(results, ecosystem, Date.now() - start);
      return { content: [{ type: "text", text: report }] };
    }
  );

  server.tool(
    "audit_directory",
    "Auto-detect and audit npm and pip manifests (package.json, requirements.txt, pyproject.toml) in a directory",
    {
      directory: z.string().describe("Path to the project root directory"),
      includeDevDeps: z.boolean().optional().describe("Include dev dependencies (default: false)"),
    },
    async ({ directory, includeDevDeps = false }) => {
      const start = Date.now();
      const lines: string[] = [];

      // npm
      let npmDeps = parseNpmManifest(directory);
      if (npmDeps.length > 0) {
        if (!includeDevDeps) npmDeps = npmDeps.filter((d) => !d.isDev);
        const npmPkgs = npmDeps.map((d) => ({ name: d.name, version: d.version, ecosystem: "npm" as Ecosystem }));
        const npmResults = await queryOsvBatch(npmPkgs);
        lines.push("── npm ─────────────────────────────────────────");
        lines.push(formatReport(npmResults, "npm", 0));
      }

      // pip
      let pipDeps = parsePipRequirements(directory);
      if (!includeDevDeps) pipDeps = pipDeps.filter((d) => !d.isDev);
      if (pipDeps.length > 0) {
        const pipPkgs = pipDeps.map((d) => ({ name: d.name, version: d.version, ecosystem: "PyPI" as Ecosystem }));
        const pipResults = await queryOsvBatch(pipPkgs);
        lines.push("── pip ─────────────────────────────────────────");
        lines.push(formatReport(pipResults, "pip", 0));
      }

      if (lines.length === 0) {
        return {
          content: [{ type: "text", text: `No supported manifest files found in ${directory}` }],
        };
      }

      lines.unshift(`🔍 Audited project in ${directory} (${Date.now() - start}ms)\n`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
