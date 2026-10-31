import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTool, hashToolDefinition, Judge, judgeFromEnv, scanToolCatalog, scanToolResult } from "@guardbee/guard-core";
import { auditCatalog } from "@guardbee/mcp-toxic-flow-auditor";
import { toolText, type Dataset, type ToolDef } from "./data.js";

/**
 * A system under test. Each task is optional: a system that does not handle
 * one (a description scanner and rug pulls) is left out of that table rather
 * than scored as missing everything.
 */
export interface System {
  name: string;
  version: string;
  /** Settings that reproduce the numbers (thresholds, modes, model). */
  settings: string;
  tools?: (tool: ToolDef) => boolean | Promise<boolean>;
  results?: (text: string) => boolean | Promise<boolean>;
  flows?: (tools: ToolDef[]) => boolean | Promise<boolean>;
  rugpulls?: (before: ToolDef, after: ToolDef) => boolean | Promise<boolean>;
  /** Batch systems (external CLIs) score a whole task at once; ids → flagged. */
  batch?: (task: keyof Dataset, data: Dataset) => Map<string, boolean>;
}

const pkgVersion = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version as string;
const here = path.dirname(fileURLToPath(import.meta.url));

const TRIFECTA = new Set(["lethal_trifecta", "single_tool_trifecta"]);

/** GuardBee's deterministic rules, as the proxy and the scanners apply them. */
export function guardbeeRules(): System {
  return {
    name: "GuardBee (rules)",
    version: `guard-core ${pkgVersion(path.join(here, "..", "..", "guard-core"))}`,
    settings: "tool: any scanToolCatalog finding; result: scanToolResult warn or block; flow: lethal trifecta; rug pull: definition hash changed",
    tools: (tool) => scanToolCatalog([tool as never]).length > 0,
    results: (text) => scanToolResult(text, "block").action !== "allow",
    flows: (tools) => auditCatalog(tools as never).findings.some((f) => TRIFECTA.has(f.patternId)),
    rugpulls: (before, after) => hashToolDefinition(before as never) !== hashToolDefinition(after as never),
  };
}

/**
 * The proxy's view of a rug pull with content checks: a changed definition
 * counts when the new one has a poisoning finding the old one did not, gains
 * a capability (egress, destructive, …), or stops claiming read-only.
 */
export function guardbeeRugPullContent(): System {
  const findings = (tool: ToolDef) => new Set(scanToolCatalog([tool as never]).map((f) => f.patternId));
  const caps = (tool: ToolDef) => new Set(classifyTool(tool as never) as string[]);
  return {
    name: "GuardBee (drift + content)",
    version: `guard-core ${pkgVersion(path.join(here, "..", "..", "guard-core"))}`,
    settings: "rug pull: changed AND (new poisoning finding OR new capability label OR readOnlyHint dropped)",
    rugpulls: (before, after) => {
      if (hashToolDefinition(before as never) === hashToolDefinition(after as never)) return false;
      const was = findings(before);
      if ([...findings(after)].some((f) => !was.has(f))) return true;
      const had = caps(before);
      if ([...caps(after)].some((c) => !had.has(c))) return true;
      return before.annotations?.["readOnlyHint"] === true && after.annotations?.["readOnlyHint"] !== true;
    },
  };
}

/** GuardBee rules plus the optional LLM judge (GUARDBEE_JUDGE_URL / GUARDBEE_JUDGE_MODEL): flagged when either says so. */
export function guardbeeWithJudge(): System | undefined {
  const config = judgeFromEnv();
  if (!config) return undefined;
  const judge = new Judge({ ...config, cacheSize: 0 });
  const rules = guardbeeRules();
  const malicious = async (text: string, where: string) => {
    try {
      const v = await judge.classifyInjection(text, { where });
      return v.verdict === "malicious" && v.confidence >= 0.7;
    } catch {
      return false;
    }
  };
  return {
    name: `GuardBee (rules + judge ${config.model})`,
    version: `guard-core ${pkgVersion(path.join(here, "..", "..", "guard-core"))}, ${config.model}`,
    settings: `rules OR judge malicious at confidence >= 0.7 (local ${config.endpoint})`,
    tools: async (tool) => (await rules.tools!(tool)) || malicious(toolText(tool), "MCP tool definition (description and parameter descriptions)"),
    results: async (text) => (await rules.results!(text)) || malicious(text, "tool result"),
  };
}

/** mcp-guardian (npm): pattern scanner for tool descriptions. */
export async function mcpGuardian(): Promise<System | undefined> {
  let lib: { scanToolDescription: (name: string, description: string) => { status: string } };
  try {
    lib = (await import("mcp-guardian")) as never;
  } catch {
    return undefined;
  }
  const dir = path.dirname(path.dirname(fs.realpathSync(path.join(here, "..", "node_modules", "mcp-guardian", "package.json"))));
  const version = JSON.parse(fs.readFileSync(path.join(dir, "mcp-guardian", "package.json"), "utf8")).version as string;
  return {
    name: "mcp-guardian",
    version,
    settings: "scanToolDescription(name, text).status !== 'clean' (text: description + parameter descriptions; for results, the result text)",
    tools: (tool) => lib.scanToolDescription(tool.name, toolText(tool)).status !== "clean",
    results: (text) => lib.scanToolDescription("result", text).status !== "clean",
  };
}

/**
 * Cisco AI Defense MCP Scanner, YARA analyzer only (offline, no API key):
 * `mcp-scanner --analyzers yara --format raw static --tools|--prompts file`.
 * Point MCP_BENCH_CISCO at the mcp-scanner executable.
 */
export function ciscoYara(): System | undefined {
  const bin = process.env["MCP_BENCH_CISCO"];
  if (!bin || !fs.existsSync(bin)) return undefined;
  let version = "unknown";
  try {
    version = execFileSync(path.join(path.dirname(bin), "pip"), ["show", "cisco-ai-mcp-scanner"], { encoding: "utf8" }).match(/^Version: (.+)$/m)?.[1] ?? version;
  } catch {
    // version stays unknown
  }
  const run = (kind: "tools" | "prompts", items: { name: string; description: string; inputSchema?: unknown }[]): Map<string, boolean> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-bench-cisco-"));
    const file = path.join(dir, `${kind}.json`);
    fs.writeFileSync(file, JSON.stringify({ [kind]: items }));
    const out = execFileSync(bin, ["--analyzers", "yara", "--format", "raw", "static", `--${kind}`, file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    fs.rmSync(dir, { recursive: true, force: true });
    const parsed = JSON.parse(out.slice(out.indexOf("{"))) as { scan_results: { tool_name?: string; prompt_name?: string; name?: string; is_safe: boolean }[] };
    return new Map(parsed.scan_results.map((r) => [r.tool_name ?? r.prompt_name ?? r.name ?? "", !r.is_safe]));
  };
  return {
    name: "Cisco MCP Scanner (YARA)",
    version,
    settings: "--analyzers yara static; flagged when is_safe is false. Tools: --tools; results: --prompts (text as the prompt description)",
    batch: (task, data) => {
      if (task === "tools") return run("tools", data.tools.map((c) => ({ ...c.tool, name: c.id, description: c.tool.description ?? "" })));
      if (task === "results") return run("prompts", data.results.map((c) => ({ name: c.id, description: c.text })));
      return new Map();
    },
  };
}

export async function allSystems(): Promise<System[]> {
  return [guardbeeRules(), guardbeeRugPullContent(), guardbeeWithJudge(), await mcpGuardian(), ciscoYara()].filter((s): s is System => !!s);
}
