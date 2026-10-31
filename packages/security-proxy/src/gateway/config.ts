import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { checkTopicReferences, judgeConfigIssue, policyShape, type TopicDefinition } from "@guardbee/guard-core";
import type { UpstreamAuth } from "./upstream-auth.js";
import { loadProxyConfig } from "../config.js";
import os from "os";
import type { AuditConfig, McpServerConfig, ProxyConfig, UpstreamConfig, UpstreamNetworkConfig, UpstreamProtocol } from "../types.js";
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
import { a2aSchema, resolveA2aConfig } from "../a2a/config.js";
import type { A2aConfig } from "../a2a/gateway.js";

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
      /** Open 2025-11-25 sessions plus 2026-07-28 contexts (see contextIdleSeconds). */
      maxSessions: number;
      /**
       * 2026-07-28 clients have no session: their calls share a context
       * (taint, PII tokens, pins) per user and X-GuardBee-Context header,
       * dropped after this many idle seconds.
       */
      contextIdleSeconds: number;
      /**
       * HMAC key (≥ 32 bytes) for the state of a 2026-07-28 approval round
       * trip; absent → a random key per process, so behind a load balancer
       * every replica must share one.
       */
      stateKey?: string;
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
  /** Agent2Agent (A2A) agents served through the gateway at <a2a.path>/<name> (HTTP mode only). */
  a2a?: A2aConfig;
  /** The person-name model (@guardbee/ner) that masking asks before it runs; absent → names are not detected. */
  ner?: NerConfig;
  /** Where persistent tool pins live (interceptors.definitionDrift.persist); default ~/.guardbee/pins.json. */
  pins?: { file?: string };
  /** Build provenance of the packages stdio upstreams run (npx); `warn` by default. */
  provenance: ProvenanceConfig;
  /** Shared counters (quotas, LLM budgets) in Redis; absent → in this process. */
  state?: StateConfig;
  /** LLM judge for borderline injection findings; absent → off. */
  judge?: GatewayJudgeConfig;
  /** Consent page and token store for upstreams.<name>.auth (oauth-per-user). */
  upstreamAuth?: { publicUrl: string; encryptionKey: Buffer; tokenFile: string };
}

export interface GatewayJudgeConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  allowRemote: boolean;
  budgetMs: number;
  onError: "open" | "closed";
  minConfidence: number;
  mayClear: boolean;
  scope: "borderline" | "results";
  cacheSize: number;
}

export interface StateConfig {
  backend: "memory" | "redis";
  url?: string;
  keyPrefix: string;
  onError: "local" | "fail-open" | "fail-closed";
  timeoutMs: number;
}


const upstreamSchema = z
  .object({
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    provenance: z.enum(["off", "warn", "require"]).optional(),
    sandbox: z
      .object({
        runtime: z.enum(["none", "docker", "podman", "bwrap", "sandbox-exec"]),
        image: z.string().min(1).optional(),
        fs: z
          .object({
            readOnly: z.array(z.string().min(1)).default([]),
            readWrite: z.array(z.string().min(1)).default([]),
            deny: z.array(z.string().min(1)).default([]),
          })
          .strict()
          .default({ readOnly: [], readWrite: [], deny: [] }),
        env: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "the name of an environment variable")).default([]),
        network: z.enum(["none", "open", "allowlist"]).default("open"),
        allowHosts: z.array(z.string().regex(/^[A-Za-z0-9*.:[\]-]+$/, "a host name, IP address or glob such as *.example.com")).optional(),
        blockPrivate: z.boolean().optional(),
        limits: z
          .object({
            cpus: z.number().positive().optional(),
            memory: z.string().regex(/^\d+[bkmg]?$/i, "a size such as 512m or 2g").optional(),
            pids: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .superRefine((sandbox, ctx) => {
        if (sandbox.network === "allowlist" && !sandbox.allowHosts?.length) ctx.addIssue({ code: "custom", path: ["allowHosts"], message: "network allowlist needs at least one host" });
        if (sandbox.network !== "allowlist" && (sandbox.allowHosts !== undefined || sandbox.blockPrivate !== undefined)) {
          ctx.addIssue({ code: "custom", path: ["network"], message: "allowHosts and blockPrivate apply to network: allowlist" });
        }
      })
      .optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    /** Whose credential reaches this HTTP upstream: each caller's own (token-exchange, oauth-per-user) or the headers (static). */
    auth: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("static") }).strict(),
        z
          .object({
            mode: z.literal("token-exchange"),
            tokenEndpoint: z.string().regex(/^https?:\/\//, "tokenEndpoint must be an http(s) URL"),
            clientId: z.string().min(1),
            clientSecretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "the name of an environment variable").optional(),
            audience: z.string().min(1).optional(),
            resource: z.string().regex(/^https?:\/\//, "resource must be an http(s) URL").optional(),
            scopes: z.array(z.string().min(1)).default([]),
            toolScopes: z.record(z.string(), z.array(z.string().min(1))).default({}),
            clientAuth: z.enum(["client_secret_basic", "client_secret_post"]).default("client_secret_basic"),
          })
          .strict(),
        z
          .object({
            mode: z.literal("oauth-per-user"),
            authorizationEndpoint: z.string().regex(/^https:\/\/|^http:\/\/(?:localhost|127\.0\.0\.1)[:/]/, "authorizationEndpoint must be https (http only on localhost)"),
            tokenEndpoint: z.string().regex(/^https:\/\/|^http:\/\/(?:localhost|127\.0\.0\.1)[:/]/, "tokenEndpoint must be https (http only on localhost)"),
            clientId: z.string().min(1),
            clientSecretEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "the name of an environment variable").optional(),
            issuer: z.string().min(1).optional(),
            resource: z.string().regex(/^https?:\/\//, "resource must be an http(s) URL").optional(),
            scopes: z.array(z.string().min(1)).default([]),
            toolScopes: z.record(z.string(), z.array(z.string().min(1))).default({}),
            clientAuth: z.enum(["client_secret_basic", "client_secret_post"]).default("client_secret_basic"),
          })
          .strict(),
      ])
      .optional(),
    protocol: z.enum(["auto", "2025-11-25", "2026-07-28"]).optional(),
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
    if (value.url !== undefined && value.sandbox !== undefined) {
      ctx.addIssue({ code: "custom", path: ["sandbox"], message: "sandbox applies to stdio upstreams (command): an HTTP server runs elsewhere" });
    }
    if (value.url !== undefined && value.provenance !== undefined) {
      ctx.addIssue({ code: "custom", path: ["provenance"], message: "provenance applies to stdio upstreams (command): an HTTP server runs elsewhere, there is no package to check" });
    }
    if (stdio && value.network !== undefined) {
      ctx.addIssue({ code: "custom", path: ["network"], message: "network rules apply to HTTP upstreams (url); for a stdio server use sandbox.network" });
    }
    if (stdio && value.auth !== undefined) ctx.addIssue({ code: "custom", path: ["auth"], message: "auth applies to HTTP upstreams (url): a stdio server gets its credentials through env" });
    if (value.auth && value.auth.mode !== "static" && Object.keys(value.headers ?? {}).some((h) => h.toLowerCase() === "authorization")) {
      ctx.addIssue({ code: "custom", path: ["headers"], message: `auth.mode ${value.auth.mode} sets each caller's own Authorization header: remove it from headers` });
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
    contextIdleSeconds: z.number().int().positive().default(1800),
    stateKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "the name of an environment variable").optional(),
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
    listen: listenSchema.default({ transport: "stdio", host: "127.0.0.1", port: 8787, path: "/mcp", apiKeys: [], maxSessions: 100, contextIdleSeconds: 1800 }),
    llm: llmSchema.optional(),
    a2a: a2aSchema.optional(),
    ner: nerSchema.optional(),
    pins: z.object({ file: z.string().min(1).optional() }).strict().optional(),
    /** Where quota and budget counters live: this process (memory) or Redis, shared by replicas. */
    state: z
      .object({
        backend: z.enum(["memory", "redis"]).default("memory"),
        url: z.string().regex(/^rediss?:\/\//, "url must start with redis:// or rediss://").optional(),
        keyPrefix: z.string().regex(/^[\w.:-]{1,64}$/, "letters, digits and . : _ -").default("guardbee"),
        onError: z.enum(["local", "fail-open", "fail-closed"]).default("local"),
        timeoutMs: z.number().int().positive().max(10_000).default(250),
      })
      .strict()
      .superRefine((state, ctx) => {
        if (state.backend === "redis" && !state.url) ctx.addIssue({ code: "custom", path: ["url"], message: 'backend "redis" needs a url (redis:// or rediss://; ${VAR} for the password)' });
      })
      .optional(),
    provenance: z
      .object({
        mode: z.enum(["off", "warn", "require"]).default("warn"),
        offline: z.boolean().default(false),
        cacheFile: z.string().min(1).optional(),
        registry: httpUrl.optional(),
        pypiIndex: z.string().regex(/^https:\/\//, "pypiIndex must start with https://").optional(),
        signers: z.record(z.string().min(1), z.string().regex(/^https:\/\//, "a certificate SAN prefix such as https://github.com/owner/")).optional(),
      })
      .strict()
      .optional(),
    /** This file also (or only) serves guardbee-hook, the policy for coding agents' own tools. */
    hooks: z.object({}).strict().optional(),
    /** Per-user upstream credentials (upstreams.<name>.auth): the consent page's public URL and the token store. */
    upstreamAuth: z
      .object({
        /** This gateway as users' browsers reach it; the OAuth redirect URI is <publicUrl>/oauth/callback. */
        publicUrl: z.string().regex(/^https:\/\/|^http:\/\/(?:localhost|127\.0\.0\.1)[:/]/, "publicUrl must be https (http only on localhost)"),
        /** 32 random bytes, base64 (openssl rand -base64 32): encrypts stored tokens and signs consent links. */
        encryptionKeyEnv: envVar,
        /** Encrypted token file; default ~/.guardbee/upstream-tokens.enc. */
        tokenFile: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    /**
     * An LLM judge for borderline injection findings (warn level): a second
     * opinion that can raise one to a block, and clear one only with mayClear.
     * Off unless configured; a non-local endpoint needs allowRemote.
     */
    judge: z
      .object({
        endpoint: httpUrl,
        model: z.string().min(1),
        apiKey: z.string().optional(),
        allowRemote: z.boolean().default(false),
        /** Time the judge may add to a call, in ms; past it the finding stays as the rules made it (onError). */
        budgetMs: z.number().int().positive().max(60_000).default(500),
        onError: z.enum(["open", "closed"]).default("open"),
        minConfidence: z.number().min(0).max(1).default(0.7),
        mayClear: z.boolean().default(false),
        /** borderline: only what the rules warned about; results: also every tool result the rules let through (one judge call each). */
        scope: z.enum(["borderline", "results"]).default("borderline"),
        cacheSize: z.number().int().min(0).max(100_000).default(1000),
      })
      .strict()
      .superRefine((judge, ctx) => {
        const issue = judgeConfigIssue({ endpoint: judge.endpoint, model: judge.model, allowRemote: judge.allowRemote });
        if (issue) ctx.addIssue({ code: "custom", path: ["endpoint"], message: issue });
      })
      .optional(),
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
    if (Object.keys(value.upstreams).length === 0 && !value.llm && !value.hooks && !value.a2a) {
      ctx.addIssue({ code: "custom", path: ["upstreams"], message: "at least one upstream is required (or an llm, a2a or hooks section)" });
    }
    if (value.a2a) {
      if (value.listen.transport !== "http") ctx.addIssue({ code: "custom", path: ["a2a"], message: "the a2a endpoints need listen.transport: http" });
      const a2aPath = value.a2a.path.replace(/\/$/, "");
      for (const [other, where] of [[value.listen.path, "listen.path"], [value.llm?.path, "llm.path"]] as const) {
        if (other && (other === a2aPath || other.startsWith(`${a2aPath}/`))) ctx.addIssue({ code: "custom", path: ["a2a", "path"], message: `a2a.path ${a2aPath} overlaps ${where} ${other}` });
      }
      // Callers must authenticate: A2A has no open loopback mode
      if (value.listen.apiKeys.length === 0 && !value.listen.oidc) {
        ctx.addIssue({ code: "custom", path: ["a2a"], message: "a2a needs listen.apiKeys or listen.oidc: unauthenticated agents are refused" });
      }
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

type AuthInput =
  | { mode: "static" }
  | ({ mode: "token-exchange" | "oauth-per-user"; clientSecretEnv?: string } & Record<string, unknown>);

/** The client secret comes from the environment, never the file. */
function resolveUpstreamAuth(name: string, auth: AuthInput | undefined): UpstreamAuth | undefined {
  if (!auth || auth.mode === "static") return auth as UpstreamAuth | undefined;
  const { clientSecretEnv, ...rest } = auth;
  let clientSecret: string | undefined;
  if (clientSecretEnv) {
    clientSecret = process.env[clientSecretEnv];
    if (!clientSecret) throw new Error(`Environment variable ${clientSecretEnv} (upstreams.${name}.auth.clientSecretEnv) is not set`);
  }
  return { ...rest, ...(clientSecret ? { clientSecret } : {}) } as unknown as UpstreamAuth;
}

function interpolateUpstream(
  name: string,
  upstream: { command?: string; args?: string[]; env?: Record<string, string>; provenance?: McpServerConfig["provenance"]; sandbox?: McpServerConfig["sandbox"]; url?: string; headers?: Record<string, string>; network?: UpstreamNetworkConfig; protocol?: UpstreamProtocol; auth?: AuthInput },
): UpstreamConfig {
  const where = `upstreams.${name}`;
  const protocol = upstream.protocol ? { protocol: upstream.protocol } : {};
  if (upstream.url !== undefined) {
    const headers = interpolateRecord(upstream.headers, where);
    const auth = resolveUpstreamAuth(name, upstream.auth);
    return { url: interpolate(upstream.url, where), ...(headers ? { headers } : {}), ...(upstream.network ? { network: upstream.network } : {}), ...protocol, ...(auth ? { auth } : {}) };
  }
  return {
    command: interpolate(upstream.command!, where),
    ...protocol,
    ...(upstream.provenance ? { provenance: upstream.provenance } : {}),
    ...(upstream.sandbox ? { sandbox: upstream.sandbox } : {}),
    args: upstream.args?.map((arg) => interpolate(arg, where)),
    env: interpolateRecord(upstream.env, where),
  };
}

function resolveUpstreamAuthConfig(config: { publicUrl: string; encryptionKeyEnv: string; tokenFile?: string }): NonNullable<GatewayConfig["upstreamAuth"]> {
  const raw = process.env[config.encryptionKeyEnv];
  if (!raw) throw new Error(`Environment variable ${config.encryptionKeyEnv} (upstreamAuth.encryptionKeyEnv) is not set`);
  const encryptionKey = Buffer.from(raw, "base64");
  if (encryptionKey.length !== 32) throw new Error(`upstreamAuth.encryptionKeyEnv: ${config.encryptionKeyEnv} must be 32 bytes, base64 (openssl rand -base64 32)`);
  return { publicUrl: config.publicUrl.replace(/\/$/, ""), encryptionKey, tokenFile: config.tokenFile ?? path.join(os.homedir(), ".guardbee", "upstream-tokens.enc") };
}

function resolveStateKey(name: string): string {
  const key = process.env[name];
  if (!key) throw new Error(`Environment variable ${name} (listen.stateKeyEnv) is not set`);
  if (Buffer.byteLength(key, "utf8") < 32) throw new Error(`listen.stateKeyEnv: ${name} must hold at least 32 bytes`);
  return key;
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
  const { ldap: rawLdap, stateKeyEnv, ...listenRest } = cfg.listen;
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
            ...(stateKeyEnv ? { stateKey: resolveStateKey(stateKeyEnv) } : {}),
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
    ...(cfg.a2a ? { a2a: resolveA2aConfig(cfg.a2a, interpolate) } : {}),
    ...(cfg.ner ? { ner: resolveNer(cfg.ner) } : {}),
    ...(cfg.pins ? { pins: cfg.pins } : {}),
    provenance: cfg.provenance ?? { mode: "warn", offline: false },
    ...(cfg.state && cfg.state.backend === "redis" ? { state: { ...cfg.state, url: interpolate(cfg.state.url!, "state.url") } } : {}),
    ...(cfg.upstreamAuth ? { upstreamAuth: resolveUpstreamAuthConfig(cfg.upstreamAuth) } : {}),
    ...(cfg.judge ? { judge: { ...cfg.judge, ...(cfg.judge.apiKey ? { apiKey: interpolate(cfg.judge.apiKey, "judge.apiKey") } : {}) } } : {}),
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
