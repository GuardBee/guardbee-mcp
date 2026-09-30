export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

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
    };
    piiMasking?: {
      enabled: boolean;
      patterns?: string[];
    };
  };
};

export type InterceptResult =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "warn"; reason: string };

export type AuditEvent = {
  ts: string;
  type: "tool_call" | "tool_response" | "blocked" | "warn" | "toxic_flow" | "resource_read";
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
