import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { checkTopicReferences, policyShape, type TopicDefinition } from "@guardbee/guard-core";
import { loadProxyConfig } from "../config.js";
import os from "os";
import type { AuditConfig, McpServerConfig, ProxyConfig, UpstreamConfig, UpstreamNetworkConfig } from "../types.js";
import type { ExporterConfig } from "../audit/exporters.js";
import type { Label } from "./labels.js";
import type { PolicyAction, PolicyRule } from "./policy.js";
import type { OidcConfig } from "../auth.js";
import type { ProvenanceConfig } from "./provenance.js";
import type { DirectoryConfig } from "../directory.js";
import type { QuotaRule } from "./quota.js";
import type { TaintBasis, TaintMode } from "./taint.js";
import type { ApprovalChannel } from "./approval.js";
import type { NerConfig } from "./ner.js";
import { llmSchema, resolveLlmConfig, type LlmConfig } from "../llm/config.js";

/** How the agent reaches the proxy. */
export type ListenConfig =
  | { transport: "stdio" }
  | {
      transport: "http";
      host: string;
      port: number;
      path: string;
      /** Accepted Bearer keys; beyond loopback, keys or `oidc` are required. */
      apiKeys: string[];
      /** Accept JWTs from this OpenID Connect issuer; the user and groups feed rules and audit. */
      oidc?: OidcConfig;
      /** Add the user's LDAP / Active Directory groups to the token's. */
      ldap?: DirectoryConfig;
      maxSessions: number;
    };

/** Where the policy (labels, rules, taint, approval, defaults, interceptors) comes from. */
export type PolicySourceConfig = { source: "local" } | { source: "dashboard"; refreshSeconds: number };

export interface ToolExposure {
  /** Allowlist; absent → every tool. */
  expose?: string[];
  hide: string[];
  descriptions: Record<string, string>;
}

export interface GatewayConfig {
  upstreams: Record<string, UpstreamConfig>;
  policy: PolicySourceConfig;
  listen: ListenConfig;
  /** Prefix tool and prompt names with `<upstream>__`. Off only for the legacy single-server config. */
  namespaced: boolean;
  /** Label overrides by the tool name the agent sees; replaces the heuristic labels entirely. */
  labels: Record<string, Label[]>;
  /** Subjects for `match.topic` rules; absent → none. */
  topics?: TopicDefinition[];
  /** Which tools the agent sees (globs on the name it sees) and descriptions you wrote. */
  tools: ToolExposure;
  rules: PolicyRule[];
  /** Call caps over a window, counted across sessions (see gateway/quota.ts). */
  quotas: QuotaRule[];
  taint: { mode: TaintMode; basis: TaintBasis };
  /**
   * How long an `approve` decision waits before it becomes a deny, and where
   * to ask, in order: the client's own prompt (MCP elicitation) and/or the
   * GuardBee dashboard (needs audit.dashboard).
   */
  approval: { timeoutSeconds: number; channels: ApprovalChannel[] };
  defaults: { action: PolicyAction };
  audit: AuditConfig;
  interceptors: NonNullable<ProxyConfig["interceptors"]>;
  /** OpenAI/Anthropic-compatible endpoints next to /mcp (HTTP mode only). */
  llm?: LlmConfig;
  /** The person-name model (@guardbee/ner) that masking asks before it runs; absent → names are not detected. */
  ner?: NerConfig;
  /** Where persistent tool pins live (interceptors.definitionDrift.persist); default ~/.guardbee/pins.json. */
  pins?: { file?: string };
  /** Build provenance of the packages stdio upstreams run (npx); `warn` by default. */
  provenance: ProvenanceConfig;
}


const upstreamSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    provenance: z.enum(["off", "warn", "require"]).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    network: z
      .object({
        mode: z.enum(["open", "allowlist"]).optional(),
        allowHosts: z.array(z.string().regex(/^[A-Za-z0-9*.:[\]-]+$/, "a host name, IP address or glob such as *.example.com")).optional(),
        blockPrivate: z.boolean().optional(),
      })
      .strict()
      .superRefine((network, ctx) => {
        if (network.mode === "allowlist" && !network.allowHosts?.length) ctx.addIssue({ code: "custom", path: ["allowHosts"], message: "mode allowlist needs at least one host" });
      })
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const stdio = value.command !== undefined || value.args !== undefined || value.env !== undefined;
    const http = value.url !== undefined || value.headers !== undefined;
    if (value.url !== undefined && value.provenance !== undefined) {
      ctx.addIssue({ code: "custom", path: ["provenance"], message: "provenance applies to stdio upstreams (command): an HTTP server runs elsewhere, there is no package to check" });
    }
    if (stdio && value.network !== undefined) {
      ctx.addIssue({ code: "custom", path: ["network"], message: "network rules apply to HTTP upstreams (url); a stdio server opens its own connections, which the proxy cannot see without a sandbox" });
    }
    if (stdio && http) ctx.addIssue({ code: "custom", message: "an upstream is either command/args/env (stdio) or url/headers (HTTP), not both" });
    else if (http && value.url === undefined) ctx.addIssue({ code: "custom", message: "an HTTP upstream needs a url" });
    else if (!http && value.command === undefined) ctx.addIssue({ code: "custom", message: "an upstream needs a command or a url" });
    if (value.url !== undefined && !/^https?:\/\//.test(value.url)) {
      ctx.addIssue({ code: "custom", message: "url must start with http:// or https://" });
    }
  });

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const envVar = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "the name of an environment variable");
const httpUrl = z.string().regex(/^https?:\/\//, "url must start with http:// or https://");
const batching = { batchSize: z.number().int().positive().max(5000).optional(), flushIntervalMs: z.number().int().min(100).optional() };

/** SIEM destinations; credentials come from the environment, never the file. */
const exporterSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("splunk"), url: httpUrl, tokenEnv: envVar, index: z.string().optional(), sourcetype: z.string().optional(), ...batching }).strict(),
  z
    .object({
      type: z.literal("elastic"),
      url: httpUrl,
      index: z.string().min(1),
      apiKeyEnv: envVar.optional(),
      usernameEnv: envVar.optional(),
      passwordEnv: envVar.optional(),
      ...batching,
    })
    .strict()
    .refine((e) => !(e.apiKeyEnv && e.usernameEnv), "use apiKeyEnv or usernameEnv/passwordEnv, not both"),
  z
    .object({
      type: z.literal("syslog"),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535).default(514),
      protocol: z.enum(["udp", "tcp", "tls"]).default("tcp"),
      format: z.enum(["cef", "json"]).default("cef"),
      framing: z.enum(["octet", "newline"]).default("octet"),
      facility: z.number().int().min(0).max(23).default(13),
      appName: z.string().regex(/^[\x21-\x7e]{1,48}$/, "printable ASCII, no spaces, at most 48 characters").optional(),
      caFile: z.string().optional(),
      ...batching,
    })
    .strict(),
]);

type ExporterYaml = z.infer<typeof exporterSchema>;

function resolveExporter(exporter: ExporterYaml, index: number): ExporterConfig {
  const env = (name: string, field: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} (audit.exporters[${index}].${field}) is not set`);
    return value;
  };
  const batching = { ...(exporter.batchSize ? { batchSize: exporter.batchSize } : {}), ...(exporter.flushIntervalMs ? { flushIntervalMs: exporter.flushIntervalMs } : {}) };
  switch (exporter.type) {
    case "splunk":
      return { type: "splunk", url: exporter.url, token: env(exporter.tokenEnv, "tokenEnv"), ...(exporter.index ? { index: exporter.index } : {}), ...(exporter.sourcetype ? { sourcetype: exporter.sourcetype } : {}), ...batching };
    case "elastic":
      return {
        type: "elastic",
        url: exporter.url,
        index: exporter.index,
        ...(exporter.apiKeyEnv ? { apiKey: env(exporter.apiKeyEnv, "apiKeyEnv") } : {}),
        ...(exporter.usernameEnv ? { username: env(exporter.usernameEnv, "usernameEnv") } : {}),
        ...(exporter.passwordEnv ? { password: env(exporter.passwordEnv, "passwordEnv") } : {}),
        ...batching,
      };
    case "syslog": {
      const { type: _type, batchSize: _b, flushIntervalMs: _f, ...rest } = exporter;
      return { type: "syslog", ...rest, ...batching };
    }
  }
}

/**
 * Person names come from a model: a `guardbee-ner serve` sidecar (url), or
 * @guardbee/ner in this process (modelDir, or its default cache). Deployment,
 * not policy: a dashboard policy cannot point it anywhere.
 */
const nerSchema = z
  .object({
    url: httpUrl.optional(),
    tokenEnv: envVar.optional(),
    modelDir: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(60_000).default(5000),
  })
  .strict()
  .superRefine((ner, ctx) => {
    if (ner.url && ner.modelDir) ctx.addIssue({ code: "custom", message: "use url (a guardbee-ner sidecar) or modelDir (in this process), not both" });
    if (ner.tokenEnv && !ner.url) ctx.addIssue({ code: "custom", path: ["tokenEnv"], message: "tokenEnv is for a sidecar (url)" });
    if (ner.url?.startsWith("http://") && !LOOPBACK.has(new URL(ner.url).hostname.replace(/^\[|\]$/g, ""))) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "the texts would cross the network in the clear: use https:// for a sidecar on another host" });
    }
  });

function resolveNer(ner: z.infer<typeof nerSchema>): NerConfig {
  if (!ner.url) return { ...(ner.modelDir ? { modelDir: ner.modelDir } : {}), timeoutMs: ner.timeoutMs };
  let token: string | undefined;
  if (ner.tokenEnv) {
    token = process.env[ner.tokenEnv];
    if (!token) throw new Error(`Environment variable ${ner.tokenEnv} (ner.tokenEnv) is not set`);
  }
  return { url: ner.url, ...(token ? { token } : {}), timeoutMs: ner.timeoutMs };
}

const listenSchema = z
  .object({
    transport: z.enum(["stdio", "http"]).default("stdio"),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(8787),
    path: z.string().startsWith("/").default("/mcp"),
    apiKeys: z.array(z.string()).default([]),
    oidc: z
      .object({
        issuer: z.string().regex(/^https?:\/\//, "issuer must start with http:// or https://"),
        audience: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).transform((value) => (Array.isArray(value) ? value : [value])),
        jwksUri: z.string().regex(/^https?:\/\//, "jwksUri must start with http:// or https://").optional(),
        userClaim: z.string().min(1).default("sub"),
        groupsClaim: z.string().min(1).default("groups"),
        resource: z.string().regex(/^https?:\/\//, "resource must start with http:// or https://").optional(),
      })
      .strict()
      .optional(),
    maxSessions: z.number().int().positive().default(100),
    ldap: z
      .object({
        url: z.string().regex(/^ldaps?:\/\//, "url must start with ldap:// or ldaps://"),
        bindDn: z.string().min(1),
        bindPasswordEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "the name of an environment variable"),
        baseDn: z.string().min(1),
        userFilter: z.string().includes("{user}", { message: "userFilter needs a {user} placeholder" }).default("(|(uid={user})(mail={user})(userPrincipalName={user})(sAMAccountName={user}))"),
        groupAttribute: z.string().min(1).optional(),
        groupSearch: z
          .object({ baseDn: z.string().min(1), filter: z.string().min(1).default("(member={dn})"), nameAttribute: z.string().min(1).default("cn") })
          .strict()
          .optional(),
        groupName: z.enum(["cn", "dn"]).default("cn"),
        cacheSeconds: z.number().int().min(0).default(300),
        timeoutMs: z.number().int().positive().default(5000),
        caFile: z.string().optional(),
        onError: z.enum(["deny", "token-groups"]).default("deny"),
      })
      .strict()
      .refine((ldap) => ldap.groupAttribute !== undefined || ldap.groupSearch !== undefined, "set groupAttribute (e.g. memberOf) or groupSearch")
      .optional(),
  })
  .strict();

const yamlSchema = z
  .object({
    version: z.literal(1),
    upstreams: z.record(z.string(), upstreamSchema).default({}).superRefine((upstreams, ctx) => {
      const names = Object.keys(upstreams);
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
    ...policyShape,
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
        exporters: z.array(exporterSchema).default([]),
      })
      .strict()
      .default({ enabled: true, sink: "console", includePayloads: false, exporters: [] }),
    policy: z
      .object({
        source: z.enum(["local", "dashboard"]).default("local"),
        refreshSeconds: z.number().int().min(10).default(60),
      })
      .strict()
      .default({ source: "local", refreshSeconds: 60 }),
    listen: listenSchema.default({ transport: "stdio", host: "127.0.0.1", port: 8787, path: "/mcp", apiKeys: [], maxSessions: 100 }),
    llm: llmSchema.optional(),
    ner: nerSchema.optional(),
    pins: z.object({ file: z.string().min(1).optional() }).strict().optional(),
    provenance: z
      .object({
        mode: z.enum(["off", "warn", "require"]).default("warn"),
        offline: z.boolean().default(false),
        cacheFile: z.string().min(1).optional(),
        registry: httpUrl.optional(),
      })
      .strict()
      .optional(),
    /** This file also (or only) serves guardbee-hook, the policy for coding agents' own tools. */
    hooks: z.object({}).strict().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    checkTopicReferences(value, ctx);
    // A per-upstream PII selection names an upstream or an LLM provider
    const known = new Set([...Object.keys(value.upstreams), ...Object.keys(value.llm?.providers ?? {})]);
    for (const name of Object.keys(value.interceptors?.piiMasking?.upstreams ?? {})) {
      if (!known.has(name)) {
        ctx.addIssue({ code: "custom", path: ["interceptors", "piiMasking", "upstreams", name], message: `no upstream or LLM provider named "${name}"` });
      }
    }
    if (Object.keys(value.upstreams).length === 0 && !value.llm && !value.hooks) {
      ctx.addIssue({ code: "custom", path: ["upstreams"], message: "at least one upstream is required (or an llm or hooks section)" });
    }
    const { listen, llm } = value;
    if (llm && listen.transport !== "http") {
      ctx.addIssue({ code: "custom", path: ["llm"], message: "the llm endpoints need listen.transport: http" });
    }
    const topicIds = new Set(value.topics.map((topic) => topic.id));
    for (const id of llm?.sensitive?.on.topics ?? []) {
      if (!topicIds.has(id)) ctx.addIssue({ code: "custom", path: ["llm", "sensitive", "on", "topics"], message: `no topic with id "${id}" in topics` });
    }
    if (llm && llm.path === listen.path) {
      ctx.addIssue({ code: "custom", path: ["llm", "path"], message: `llm.path and listen.path are both ${listen.path}` });
    }
    const keyed = listen.apiKeys.length > 0 || listen.oidc !== undefined;
    if (listen.transport === "http" && !LOOPBACK.has(listen.host) && !keyed && !(llm && llm.keys.length > 0 && Object.keys(value.upstreams).length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["listen", "apiKeys"],
        message: `listening on ${listen.host} needs at least one API key or listen.oidc; without one anyone on the network can drive your MCP servers`,
      });
    }
    if (llm && listen.transport === "http" && !LOOPBACK.has(listen.host) && !keyed && llm.keys.length === 0) {
      ctx.addIssue({ code: "custom", path: ["llm", "keys"], message: `listening on ${listen.host} needs llm.keys, listen.apiKeys or listen.oidc; without one anyone on the network can spend your provider keys` });
    }
  });

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

function interpolateUpstream(
  name: string,
  upstream: { command?: string; args?: string[]; env?: Record<string, string>; provenance?: McpServerConfig["provenance"]; url?: string; headers?: Record<string, string>; network?: UpstreamNetworkConfig },
): UpstreamConfig {
  const where = `upstreams.${name}`;
  if (upstream.url !== undefined) {
    const headers = interpolateRecord(upstream.headers, where);
    return { url: interpolate(upstream.url, where), ...(headers ? { headers } : {}), ...(upstream.network ? { network: upstream.network } : {}) };
  }
  return {
    command: interpolate(upstream.command!, where),
    ...(upstream.provenance ? { provenance: upstream.provenance } : {}),
    args: upstream.args?.map((arg) => interpolate(arg, where)),
    env: interpolateRecord(upstream.env, where),
  };
}

function resolveLdap(ldap: { bindPasswordEnv: string } & Omit<DirectoryConfig, "bindPassword">): DirectoryConfig {
  const { bindPasswordEnv, ...rest } = ldap;
  const bindPassword = process.env[bindPasswordEnv];
  if (!bindPassword) throw new Error(`Environment variable ${bindPasswordEnv} (listen.ldap.bindPasswordEnv) is not set`);
  return { ...rest, bindPassword };
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
  if (cfg.policy.source === "dashboard" && !cfg.audit.dashboard) {
    throw new Error(`Invalid ${fileLabel}:\n  - policy.source: "dashboard" needs audit.dashboard (url and apiKeyEnv)`);
  }
  if (cfg.approval.channels.includes("dashboard") && !cfg.audit.dashboard) {
    throw new Error(`Invalid ${fileLabel}:\n  - approval.channels: "dashboard" needs audit.dashboard (url and apiKeyEnv)`);
  }
  // The directory password is resolved from the environment, like every other secret
  const { ldap: rawLdap, ...listenRest } = cfg.listen;
  return {
    upstreams: Object.fromEntries(
      Object.entries(cfg.upstreams).map(([name, upstream]) => [name, interpolateUpstream(name, upstream)]),
    ),
    policy: cfg.policy.source === "dashboard" ? { source: "dashboard", refreshSeconds: cfg.policy.refreshSeconds } : { source: "local" },
    listen:
      cfg.listen.transport === "http"
        ? {
            ...listenRest,
            transport: "http",
            apiKeys: listenRest.apiKeys.map((key) => interpolate(key, "listen.apiKeys")),
            ...(rawLdap ? { ldap: resolveLdap(rawLdap) } : {}),
          }
        : { transport: "stdio" },
    namespaced: true,
    labels: cfg.labels,
    topics: cfg.topics,
    tools: cfg.tools,
    rules: cfg.rules,
    quotas: cfg.quotas,
    taint: cfg.taint,
    approval: cfg.approval,
    defaults: cfg.defaults,
    audit: { ...cfg.audit, dashboard: resolveDashboard(cfg.audit.dashboard), exporters: cfg.audit.exporters.map(resolveExporter) },
    interceptors: cfg.interceptors,
    ...(cfg.llm ? { llm: resolveLlmConfig(cfg.llm) } : {}),
    ...(cfg.ner ? { ner: resolveNer(cfg.ner) } : {}),
    ...(cfg.pins ? { pins: cfg.pins } : {}),
    provenance: cfg.provenance ?? { mode: "warn", offline: false },
  };
}

/**
 * The 0.x single-server config keeps its behavior: tool names are not prefixed,
 * payloads are logged, a toxic flow only warns, and no provenance check runs.
 */
export function fromLegacyConfig(config: ProxyConfig): GatewayConfig {
  return {
    upstreams: { default: config.server },
    provenance: { mode: "off", offline: false },
    policy: { source: "local" },
    listen: { transport: "stdio" },
    namespaced: false,
    labels: {},
    tools: { hide: [], descriptions: {} },
    rules: [],
    quotas: [],
    taint: { mode: "warn", basis: "capability" },
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
