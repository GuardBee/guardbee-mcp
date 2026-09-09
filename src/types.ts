export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type ProxyConfig = {
  server: McpServerConfig;
  audit?: {
    enabled: boolean;
    sink: "console" | "file";
    filePath?: string;
  };
  interceptors?: {
    promptInjection?: {
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
  type: "tool_call" | "tool_response" | "blocked" | "warn";
  tool?: string;
  server?: string;
  input?: unknown;
  output?: unknown;
  reason?: string;
};
