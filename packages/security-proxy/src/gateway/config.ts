import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { loadProxyConfig } from "../config.js";
import type { AuditConfig, McpServerConfig, ProxyConfig } from "../types.js";
import { LABELS, type Label } from "./labels.js";
import type { PolicyAction, PolicyRule } from "./policy.js";
import type { TaintMode } from "./taint.js";

export interface GatewayConfig {
  upstreams: Record<string, McpServerConfig>;
  /** Prefix tool and prompt names with `<upstream>__`. Off only for the legacy single-server config. */
  namespaced: boolean;
  /** Label overrides by the tool name the agent sees; replaces the heuristic labels entirely. */
  labels: Record<string, Label[]>;
  rules: PolicyRule[];
  taint: { mode: TaintMode };
  defaults: { action: PolicyAction };
  audit: AuditConfig;
  interceptors: NonNullable<ProxyConfig["interceptors"]>;
}

const labelSchema = z.enum(LABELS);
const actionSchema = z.enum(["allow", "deny", "mask", "warn"]);
const interceptorSchema = z.object({ enabled: z.boolean(), action: z.enum(["block", "warn"]) });

const upstreamSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.url !== undefined) {
      ctx.addIssue({ code: "custom", message: "HTTP upstreams (url) are not supported yet; run the server with command/args" });
    } else if (value.command === undefined) {
      ctx.addIssue({ code: "custom", message: "an upstream needs a command" });
    }
  });

const yamlSchema = z
  .object({
    version: z.literal(1),
    upstreams: z.record(z.string(), upstreamSchema).superRefine((upstreams, ctx) => {
      const names = Object.keys(upstreams);
      if (names.length === 0) ctx.addIssue({ code: "custom", message: "at least one upstream is required" });
      for (const name of names) {
        // Checked here, not as the record's key schema: zod replaces a key schema's message with "Invalid key in record".
        if (!/^[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/.test(name)) {
          ctx.addIssue({
            code: "custom",
            path: [name],
            message: "upstream names use letters, digits, - and single _ (a double __ is the namespace separator)",
          });
        }
      }
    }),
    labels: z.record(z.string(), z.array(labelSchema)).default({}),
    rules: z
      .array(
        z
          .object({
            id: z.string().optional(),
            match: z
              .object({
                tool: z.string().optional(),
                upstream: z.string().optional(),
                label: labelSchema.optional(),
                session: z.enum(["clean", "tainted"]).optional(),
              })
              .strict(),
            action: actionSchema,
          })
          .strict(),
      )
      .default([]),
    taint: z.object({ mode: z.enum(["strict", "warn", "off"]).default("strict") }).strict().default({ mode: "strict" }),
    defaults: z.object({ action: actionSchema.default("allow") }).strict().default({ action: "allow" }),
    audit: z
      .object({
        enabled: z.boolean().default(true),
        sink: z.enum(["console", "file"]).default("console"),
        filePath: z.string().optional(),
        includePayloads: z.boolean().default(false),
      })
      .strict()
      .default({ enabled: true, sink: "console", includePayloads: false }),
    interceptors: z
      .object({
        promptInjection: interceptorSchema.optional(),
        toolResultInjection: interceptorSchema.optional(),
        definitionDrift: interceptorSchema.optional(),
        piiMasking: z.object({ enabled: z.boolean(), patterns: z.array(z.string()).optional() }).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

/** Replace `${VAR}` with the environment value; config files never hold the secret itself. */
function interpolate(value: string, where: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined) throw new Error(`Environment variable ${name} (used in ${where}) is not set`);
    return resolved;
  });
}

function interpolateUpstream(name: string, upstream: McpServerConfig): McpServerConfig {
  const where = `upstreams.${name}`;
  return {
    command: interpolate(upstream.command, where),
    args: upstream.args?.map((arg) => interpolate(arg, where)),
    env: upstream.env
      ? Object.fromEntries(Object.entries(upstream.env).map(([k, v]) => [k, interpolate(v, where)]))
      : undefined,
  };
}

export function parseGatewayYaml(source: string, fileLabel = "guardbee-proxy.yaml"): GatewayConfig {
  const parsed = yamlSchema.safeParse(parseYaml(source));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`Invalid ${fileLabel}:\n${issues.join("\n")}`);
  }
  const cfg = parsed.data;
  return {
    upstreams: Object.fromEntries(
      Object.entries(cfg.upstreams).map(([name, upstream]) => [
        name,
        interpolateUpstream(name, upstream as McpServerConfig),
      ]),
    ),
    namespaced: true,
    labels: cfg.labels,
    rules: cfg.rules,
    taint: cfg.taint,
    defaults: cfg.defaults,
    audit: cfg.audit,
    interceptors: cfg.interceptors,
  };
}

/**
 * The 0.x single-server config keeps its behavior: tool names are not prefixed,
 * payloads are logged, and a toxic flow only warns.
 */
export function fromLegacyConfig(config: ProxyConfig): GatewayConfig {
  return {
    upstreams: { default: config.server },
    namespaced: false,
    labels: {},
    rules: [],
    taint: { mode: "warn" },
    defaults: { action: "allow" },
    audit: { includePayloads: true, ...(config.audit ?? { enabled: true, sink: "console" }) },
    interceptors: config.interceptors ?? {},
  };
}

function configFlag(argv: string[]): string | null {
  const end = argv.indexOf("--");
  const own = end === -1 ? argv : argv.slice(0, end);
  const at = own.indexOf("--config");
  if (at === -1) return null;
  const value = own[at + 1];
  if (!value) throw new Error("--config needs a file path");
  return value;
}

function isYaml(filePath: string): boolean {
  return /\.ya?ml$/i.test(filePath);
}

/**
 * 1. `--config <file.yaml>`  2. GUARDBEE_PROXY_CONFIG pointing at a .yaml/.yml
 * 3. ./guardbee-proxy.yaml (or .yml)  4. the legacy JSON / `-- <command>` / PROXY_* setup.
 */
export function loadGatewayConfig(argv: string[] = process.argv, cwd: string = process.cwd()): GatewayConfig {
  const explicit = configFlag(argv);
  const fromEnv = process.env["GUARDBEE_PROXY_CONFIG"];
  const candidates = explicit
    ? [explicit]
    : fromEnv && isYaml(fromEnv)
      ? [fromEnv]
      : [path.join(cwd, "guardbee-proxy.yaml"), path.join(cwd, "guardbee-proxy.yml")];

  for (const candidate of candidates) {
    const resolved = candidate.startsWith("~/") ? path.join(process.env["HOME"] ?? "", candidate.slice(2)) : candidate;
    if (!fs.existsSync(resolved)) {
      if (candidate === explicit || candidate === fromEnv) throw new Error(`Config file not found: ${resolved}`);
      continue;
    }
    return parseGatewayYaml(fs.readFileSync(resolved, "utf8"), path.basename(resolved));
  }

  return fromLegacyConfig(loadProxyConfig(argv));
}
