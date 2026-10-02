import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { loadProxyConfig } from "../config.js";
import os from "os";
import type { AuditConfig, McpServerConfig, ProxyConfig, UpstreamConfig } from "../types.js";
import { LABELS, type Label } from "./labels.js";
import type { PolicyAction, PolicyRule } from "./policy.js";
import type { TaintMode } from "./taint.js";
import type { ApprovalChannel } from "./approval.js";

/** How the agent reaches the proxy. */
export type ListenConfig =
  | { transport: "stdio" }
  | {
      transport: "http";
      host: string;
      port: number;
      path: string;
      /** Accepted Bearer keys; required unless the host is loopback. */
      apiKeys: string[];
      maxSessions: number;
    };

export interface GatewayConfig {
  upstreams: Record<string, UpstreamConfig>;
  listen: ListenConfig;
  /** Prefix tool and prompt names with `<upstream>__`. Off only for the legacy single-server config. */
  namespaced: boolean;
  /** Label overrides by the tool name the agent sees; replaces the heuristic labels entirely. */
  labels: Record<string, Label[]>;
  rules: PolicyRule[];
  taint: { mode: TaintMode };
  /**
   * How long an `approve` decision waits before it becomes a deny, and where
   * to ask, in order: the client's own prompt (MCP elicitation) and/or the
   * GuardBee dashboard (needs audit.dashboard).
   */
  approval: { timeoutSeconds: number; channels: ApprovalChannel[] };
  defaults: { action: PolicyAction };
  audit: AuditConfig;
  interceptors: NonNullable<ProxyConfig["interceptors"]>;
}

const labelSchema = z.enum(LABELS);
const actionSchema = z.enum(["allow", "deny", "mask", "warn", "approve"]);
const interceptorSchema = z.object({ enabled: z.boolean(), action: z.enum(["block", "warn"]) }).strict();

const upstreamSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const stdio = value.command !== undefined || value.args !== undefined || value.env !== undefined;
    const http = value.url !== undefined || value.headers !== undefined;
    if (stdio && http) ctx.addIssue({ code: "custom", message: "an upstream is either command/args/env (stdio) or url/headers (HTTP), not both" });
    else if (http && value.url === undefined) ctx.addIssue({ code: "custom", message: "an HTTP upstream needs a url" });
    else if (!http && value.command === undefined) ctx.addIssue({ code: "custom", message: "an upstream needs a command or a url" });
    if (value.url !== undefined && !/^https?:\/\//.test(value.url)) {
      ctx.addIssue({ code: "custom", message: "url must start with http:// or https://" });
    }
  });

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const listenSchema = z
  .object({
    transport: z.enum(["stdio", "http"]).default("stdio"),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(8787),
    path: z.string().startsWith("/").default("/mcp"),
    apiKeys: z.array(z.string()).default([]),
    maxSessions: z.number().int().positive().default(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.transport === "http" && !LOOPBACK.has(value.host) && value.apiKeys.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKeys"],
        message: `listening on ${value.host} needs at least one API key; without one anyone on the network can drive your MCP servers`,
      });
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
                args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
              })
              .strict(),
            action: actionSchema,
            mask: z.object({ fields: z.array(z.string()).min(1) }).strict().optional(),
          })
          .strict()
          .refine((rule) => rule.mask === undefined || rule.action === "mask", {
            message: "mask.fields only applies to action: mask",
            path: ["mask"],
          }),
      )
      .default([]),
    taint: z.object({ mode: z.enum(["strict", "approve", "warn", "off"]).default("strict") }).strict().default({ mode: "strict" }),
    approval: z
      .object({
        timeoutSeconds: z.number().int().positive().default(120),
        channels: z.array(z.enum(["elicitation", "dashboard"])).min(1).default(["elicitation"]),
      })
      .strict()
      .default({ timeoutSeconds: 120, channels: ["elicitation"] }),
    defaults: z.object({ action: actionSchema.default("allow") }).strict().default({ action: "allow" }),
    audit: z
      .object({
        enabled: z.boolean().default(true),
        sink: z.enum(["console", "file"]).default("console"),
        filePath: z.string().optional(),
        includePayloads: z.boolean().default(false),
        dashboard: z
          .object({
            url: z.string().regex(/^https?:\/\//, "url must start with http:// or https://"),
            apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "apiKeyEnv is the name of an environment variable"),
            source: z.string().optional(),
            batchSize: z.number().int().positive().max(1000).default(100),
            flushIntervalMs: z.number().int().min(100).default(5000),
          })
          .strict()
          .optional(),
      })
      .strict()
      .default({ enabled: true, sink: "console", includePayloads: false }),
    listen: listenSchema.default({ transport: "stdio", host: "127.0.0.1", port: 8787, path: "/mcp", apiKeys: [], maxSessions: 100 }),
    interceptors: z
      .object({
        promptInjection: interceptorSchema.optional(),
        toolResultInjection: interceptorSchema.optional(),
        definitionDrift: interceptorSchema
          .extend({ recheck: z.enum(["every-call", "on-change"]).optional() })
          .optional(),
        piiMasking: z
          .object({
            enabled: z.boolean(),
            patterns: z.array(z.string()).optional(),
            mode: z.enum(["redact", "tokenize"]).optional(),
            detokenizeForEgress: z.boolean().optional(),
          })
          .strict()
          .optional(),
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

function interpolateRecord(record: Record<string, string> | undefined, where: string): Record<string, string> | undefined {
  return record ? Object.fromEntries(Object.entries(record).map(([k, v]) => [k, interpolate(v, where)])) : undefined;
}

function interpolateUpstream(name: string, upstream: { command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }): UpstreamConfig {
  const where = `upstreams.${name}`;
  if (upstream.url !== undefined) {
    const headers = interpolateRecord(upstream.headers, where);
    return { url: interpolate(upstream.url, where), ...(headers ? { headers } : {}) };
  }
  return {
    command: interpolate(upstream.command!, where),
    args: upstream.args?.map((arg) => interpolate(arg, where)),
    env: interpolateRecord(upstream.env, where),
  };
}

function resolveDashboard(
  dashboard: { url: string; apiKeyEnv: string; source?: string; batchSize: number; flushIntervalMs: number } | undefined,
): AuditConfig["dashboard"] {
  if (!dashboard) return undefined;
  const apiKey = process.env[dashboard.apiKeyEnv];
  if (!apiKey) throw new Error(`Environment variable ${dashboard.apiKeyEnv} (audit.dashboard.apiKeyEnv) is not set`);
  return {
    url: dashboard.url,
    apiKey,
    source: dashboard.source ?? os.hostname(),
    batchSize: dashboard.batchSize,
    flushIntervalMs: dashboard.flushIntervalMs,
  };
}

export function parseGatewayYaml(source: string, fileLabel = "guardbee-proxy.yaml"): GatewayConfig {
  const parsed = yamlSchema.safeParse(parseYaml(source));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`Invalid ${fileLabel}:\n${issues.join("\n")}`);
  }
  const cfg = parsed.data;
  if (cfg.approval.channels.includes("dashboard") && !cfg.audit.dashboard) {
    throw new Error(`Invalid ${fileLabel}:\n  - approval.channels: "dashboard" needs audit.dashboard (url and apiKeyEnv)`);
  }
  return {
    upstreams: Object.fromEntries(
      Object.entries(cfg.upstreams).map(([name, upstream]) => [name, interpolateUpstream(name, upstream)]),
    ),
    listen:
      cfg.listen.transport === "http"
        ? { ...cfg.listen, transport: "http", apiKeys: cfg.listen.apiKeys.map((key) => interpolate(key, "listen.apiKeys")) }
        : { transport: "stdio" },
    namespaced: true,
    labels: cfg.labels,
    rules: cfg.rules,
    taint: cfg.taint,
    approval: cfg.approval,
    defaults: cfg.defaults,
    audit: { ...cfg.audit, dashboard: resolveDashboard(cfg.audit.dashboard) },
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
    listen: { transport: "stdio" },
    namespaced: false,
    labels: {},
    rules: [],
    taint: { mode: "warn" },
    approval: { timeoutSeconds: 120, channels: ["elicitation"] },
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
