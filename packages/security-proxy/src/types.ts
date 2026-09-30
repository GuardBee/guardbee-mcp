export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/** A Streamable HTTP MCP server the proxy connects to as a client. */
export type HttpUpstreamConfig = {
  url: string;
  headers?: Record<string, string>;
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
    definitionDrift?: {
      enabled: boolean;
      action: "block" | "warn";
      /**
       * `every-call` re-lists the upstream's tools before each call (default).
       * `on-change` re-lists only after the upstream sent tools/list_changed.
       */
      recheck?: "every-call" | "on-change";
    };
    piiMasking?: {
      enabled: boolean;
      patterns?: string[];
      /** `redact` (default) replaces PII with a fixed placeholder; `tokenize` with a reversible session token. */
      mode?: "redact" | "tokenize";
      /** Put real values back even when the tool can send data out. Off by default. */
      detokenizeForEgress?: boolean;
    };
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
  /** Hash chain: each event carries the previous event's hash. Set by AuditLogger. */
  prevHash?: string;
  hash?: string;
};
