import type { AnomalyConfig } from "./gateway/anomaly.js";
import type { ExporterConfig } from "./audit/exporters.js";
import type { PiiPresetName, PiiSelection } from "@guardbee/guard-core";

import type { SandboxConfig } from "./gateway/sandbox.js";

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Provenance check before start; overrides the top-level `provenance.mode`. */
  provenance?: "off" | "warn" | "require";
  /** Run the server in an OS sandbox (gateway/sandbox.ts); absent → a plain child process. */
  sandbox?: SandboxConfig;
  /** MCP revision to speak to this server; absent → auto (see UpstreamProtocol). */
  protocol?: UpstreamProtocol;
};

/** A Streamable HTTP MCP server the proxy connects to as a client. */
export type HttpUpstreamConfig = {
  url: string;
  headers?: Record<string, string>;
  /** Which addresses the proxy's connections to this server may reach (SSRF guard). */
  network?: UpstreamNetworkConfig;
  /** MCP revision to speak to this server; absent → auto (see UpstreamProtocol). */
  protocol?: UpstreamProtocol;
};

/**
 * `auto`: ask the server for 2026-07-28 (server/discover) and fall back to the
 * 2025-11-25 initialize handshake; a version pins that revision only.
 */
export type UpstreamProtocol = "auto" | "2025-11-25" | "2026-07-28";

/**
 * `open` (default): any host; `allowlist`: only `allowHosts`. Link-local
 * (cloud metadata), unspecified and reserved addresses are always refused.
 * `blockPrivate` refuses loopback and private addresses; when unset it follows
 * the configured URL: a server configured on a private address may stay there,
 * one configured on a public address may not reach private ones.
 */
export type UpstreamNetworkConfig = {
  mode?: "open" | "allowlist";
  allowHosts?: string[];
  blockPrivate?: boolean;
};

export type UpstreamConfig = McpServerConfig | HttpUpstreamConfig;

export function isHttpUpstream(config: UpstreamConfig): config is HttpUpstreamConfig {
  return "url" in config;
}

export type AuditConfig = {
  enabled: boolean;
  sink: "console" | "file";
  filePath?: string;
  /**
   * Write raw tool arguments and results into the log. Off → arguments are
   * stored only as a SHA-256 hash and results are left out, so the audit log
   * does not become another store of personal data. Defaults to true for the
   * legacy JSON config, false for guardbee-proxy.yaml.
   */
  includePayloads?: boolean;
  /** Also send every event, batched, to the GuardBee dashboard. */
  dashboard?: DashboardSinkConfig;
  /** And to SIEMs: Splunk HEC, Elasticsearch/OpenSearch, syslog (RFC 5424 / CEF). */
  exporters?: ExporterConfig[];
};

export type DashboardSinkConfig = {
  /** Ingest endpoint, e.g. https://app.guardbee.ai/api/v1/gateway/events */
  url: string;
  /** Workspace API key with the gateway.write scope (resolved from apiKeyEnv). */
  apiKey: string;
  /** Names this proxy in the dashboard; defaults to the host name. */
  source?: string;
  batchSize?: number;
  flushIntervalMs?: number;
};

export type ProxyConfig = {
  server: McpServerConfig;
  audit?: AuditConfig;
  interceptors?: {
    promptInjection?: {
      enabled: boolean;
      action: "block" | "warn";
    };
    toolResultInjection?: {
      enabled: boolean;
      action: "block" | "warn";
    };
    /**
     * Scan each tool definition in tools/list for poisoning (instructions aimed
     * at the model, hidden characters, a read-only annotation that lies).
     * `block` hides a tool with a critical or high finding; medium ones warn.
     */
    toolPoisoning?: {
      enabled: boolean;
      action: "block" | "warn";
    };
    /**
     * Credentials in the arguments an `egress` tool is about to receive
     * (provider keys, private keys, connection strings with a password).
     * `allowTools` exempts tools by glob, e.g. a deploy tool that takes a DB URL.
     */
    egressSecrets?: {
      enabled: boolean;
      action: "block" | "warn";
      allowTools?: string[];
    };
    /**
     * Let servers ask the agent's model for a completion (sampling), with
     * guards: only during one of the server's tool calls, no context from the
     * conversation, a token and per-call cap, an injection scan on what the
     * server sends, and the model's answer checked like an egress call.
     * Off (default): servers are not offered sampling at all.
     */
    sampling?: {
      enabled: boolean;
      action: "block" | "warn";
      /** Cap on the completion length the server may ask for (default 1024). */
      maxTokens?: number;
      /** Sampling requests allowed during one tool call (default 3). */
      maxPerCall?: number;
      /** Ask the person before each request (MCP elicitation / dashboard). */
      approval?: boolean;
    };
    definitionDrift?: {
      enabled: boolean;
      action: "block" | "warn";
      /**
       * `every-call` re-lists the upstream's tools before each call (default).
       * `on-change` re-lists only after the upstream sent tools/list_changed.
       */
      recheck?: "every-call" | "on-change";
      /**
       * Keep approved tool definitions across sessions and restarts (pins file,
       * see `pins.file`). On by default in gateway mode; the single-server `--`
       * form keeps per-session pins only.
       */
      persist?: boolean;
      /** A tool that differs from its persisted definition: refuse it, ask the person (default), or log. */
      onChange?: "block" | "approve" | "warn";
    };
    piiMasking?: {
      enabled: boolean;
      patterns?: string[];
      /** Opt-in detectors to also run: ip_address, mac_address, plate_tr. Same as listing them in `enable`. */
      include?: ("ip_address" | "mac_address" | "plate_tr")[];
      /** Which detectors mask: a preset (default ALL), then detectors to add or drop by name. */
      preset?: PiiPresetName;
      enable?: string[];
      disable?: string[];
      /** Per upstream or LLM provider name: replaces preset / enable / disable for it. */
      upstreams?: Record<string, PiiSelection>;
      /** `redact` (default) replaces PII with a fixed placeholder; `tokenize` with a reversible session token. */
      mode?: "redact" | "tokenize";
      /** Put real values back even when the tool can send data out. Off by default. */
      detokenizeForEgress?: boolean;
    };
    /**
     * Scan images, PDFs and other blobs in tool results and resources for PII
     * and credentials. `block` withholds a document that holds any; `warn` logs.
     * Off unless enabled.
     */
    documents?: {
      enabled: boolean;
      action: "block" | "warn";
      /** OCR images and scanned PDF pages (default true; needs tesseract.js). */
      ocr?: boolean;
      /** Larger documents are not read (default 25 MB). */
      maxBytes?: number;
    };
    /** Session behaviour checks; see gateway/anomaly.ts. Off unless configured. */
    anomaly?: AnomalyConfig;
  };
};

export type InterceptResult =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "warn"; reason: string };

export type AuditEvent = {
  ts: string;
  type: "tool_call" | "tool_response" | "blocked" | "warn" | "toxic_flow" | "resource_read" | "approval";
  /** MCP session (HTTP mode); absent over stdio, where the process is the session. */
  sessionId?: string;
  /** The caller's user from an OIDC token (HTTP mode); absent for API keys and stdio. */
  user?: string;
  tool?: string;
  server?: string;
  upstream?: string;
  labels?: string[];
  /** Matching policy rule (`id` or `rules[<index>]`). */
  ruleId?: string;
  taint?: { sawUntrusted: boolean; sawSensitive: boolean };
  input?: unknown;
  /** SHA-256 of the arguments, written instead of `input` when payloads are off. */
  inputHash?: string;
  output?: unknown;
  reason?: string;
  /** Where a refused network connection was going (ruleId network:*); never the request itself. */
  destination?: { host: string; address?: string };
  /**
   * Personal data the proxy found in a tool response or resource, counted by
   * category (tc_kimlik, email, iban, …; credentials as "secret"). Counts
   * only — never the values. Feeds the dashboard's KVKK report.
   */
  piiHits?: Record<string, number>;
  /**
   * Documents read in an LLM gateway request (llm.documents): what each was,
   * how much text came out, and which checks ran over that text. Never the
   * document itself; the logged input holds a placeholder with its hash.
   */
  documents?: { name: string; modality: "pdf" | "image"; bytes: number; sha256: string; pages: number; chars: number; checks: string[] }[];
  /** Token usage of an LLM gateway call, with its price when llm.pricing covers the model. */
  llm?: { model: string; routedFrom?: string; inputTokens?: number; outputTokens?: number; costUsd?: number };
  /** Hash chain: each event carries the previous event's hash. Set by AuditLogger. */
  prevHash?: string;
  hash?: string;
};
