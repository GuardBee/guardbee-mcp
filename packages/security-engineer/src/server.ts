import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { instrumentServer } from "@guardbee/mcp-telemetry";
import { z } from "zod";
import { clientFromEnv, GuardBeeApiError, type GuardBeeClient } from "./client.js";
import { formatAssessment, formatAssessments, formatFix, formatStack, formatVerification } from "./format.js";
import { detectStack, readProjectFile } from "./stack.js";

const PLATFORM = z.enum(["nginx", "apache", "express", "nextjs", "cloudflare"]);

function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): Text => ({ content: [{ type: "text", text }] });
const fail = (error: unknown): Text => ({
  content: [{ type: "text", text: error instanceof GuardBeeApiError ? `GuardBee API error (${error.status}): ${error.message}` : `Error: ${error instanceof Error ? error.message : String(error)}` }],
  isError: true,
});

export async function startServer() {
  serveStdio(() => {
    const server = new McpServer({ name: "guardbee-security-engineer", version: packageVersion() });
    instrumentServer(server, "security-engineer");
    registerTools(server);
    return server;
  });
}

/**
 * Tools for the user's coding agent. This server only reads and reports: the agent edits the
 * user's repository (with the user's approval) and GuardBee verifies against the live site.
 */
export function registerTools(server: McpServer, makeClient: () => GuardBeeClient = clientFromEnv): void {
  server.registerTool(
    "list_assessments",
    { description: "List recent GuardBee AI Security Engineer assessments of your workspace (id, site, status, risk level).", inputSchema: z.object({}) },
    async () => {
      try {
        return ok(formatAssessments(await makeClient().listAssessments()));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "get_assessment",
    {
      description: "Get the actionable findings of an assessment, highest priority first, with the platforms each can be fixed on.",
      inputSchema: z.object({ runId: z.string().min(1).describe("Assessment id from list_assessments") }),
    },
    async ({ runId }) => {
      try {
        return ok(formatAssessment(await makeClient().getAssessment(runId)));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "detect_stack",
    {
      description: "Detect how this repository is served (Next.js, Express, Nginx, Apache, Cloudflare) from its own files, and find web server config files to diff fixes against.",
      inputSchema: z.object({ projectPath: z.string().optional().describe("Repository root (default: current working directory)") }),
    },
    async ({ projectPath }) => {
      try {
        const root = projectPath ?? process.cwd();
        const { signals, notes } = await detectStack(root);
        return ok(formatStack(signals, root, notes));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "get_fix",
    {
      description:
        "Get a reviewable fix for a finding, tailored to the platform. If configPath points to the project's Nginx/Apache config, GuardBee returns an exact diff. Returns step-by-step instructions for applying the change in this repository.",
      inputSchema: z.object({
        runId: z.string().min(1),
        findingId: z.string().min(1).describe("findingId from get_assessment"),
        platform: PLATFORM.optional().describe("Defaults to the platform detected on the live site"),
        configPath: z.string().optional().describe("Nginx/Apache config file inside the project, for an exact diff"),
        projectPath: z.string().optional(),
      }),
    },
    async ({ runId, findingId, platform, configPath, projectPath }) => {
      try {
        const currentConfig = configPath ? await readProjectFile(projectPath ?? process.cwd(), configPath) : undefined;
        const fix = await makeClient().proposeFix(runId, { findingId, ...(platform ? { platform } : {}), ...(currentConfig ? { currentConfig } : {}) });
        return ok(formatFix(fix));
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "report_applied",
    {
      description: "Record in GuardBee that the fix was applied in the repository (after the user approved the change). Pass the commit SHA or PR URL as ref.",
      inputSchema: z.object({ remediationId: z.string().min(1), ref: z.string().max(500).optional() }),
    },
    async ({ remediationId, ref }) => {
      try {
        const r = await makeClient().reportApplied(remediationId, ref);
        return ok(`Recorded as applied${r.appliedRef ? ` (${r.appliedRef})` : ""}. After deployment, call verify_fix with remediationId="${r.id}".`);
      } catch (error) {
        return fail(error);
      }
    }
  );

  server.registerTool(
    "verify_fix",
    {
      description: "After the fix is deployed, ask GuardBee to re-run the check that reported the finding against the live site. Takes up to a few minutes.",
      inputSchema: z.object({ remediationId: z.string().min(1) }),
    },
    async ({ remediationId }) => {
      try {
        return ok(formatVerification(await makeClient().verify(remediationId)));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
