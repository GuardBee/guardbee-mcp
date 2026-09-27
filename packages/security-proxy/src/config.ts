import fs from "fs";
import path from "path";
import type { ProxyConfig, McpServerConfig } from "./types.js";

function parseServerFromEnv(): McpServerConfig | null {
  const cmd = process.env["PROXY_COMMAND"];
  if (!cmd) return null;
  const args = process.env["PROXY_ARGS"]?.split(" ").filter(Boolean) ?? [];
  return { command: cmd, args };
}

function parseServerFromArgs(argv: string[]): McpServerConfig | null {
  // guardbee-proxy -- npx @some/mcp-server --flag value
  const sep = argv.indexOf("--");
  if (sep === -1 || sep === argv.length - 1) return null;
  const rest = argv.slice(sep + 1);
  return { command: rest[0]!, args: rest.slice(1) };
}

function parseConfigFile(filePath: string): ProxyConfig | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as ProxyConfig;
  } catch {
    return null;
  }
}

function envEnabled(name: string, defaultEnabled: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultEnabled;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

function runtimeFromEnv(): Pick<ProxyConfig, "audit" | "interceptors"> {
  const sink = process.env["PROXY_LOG"] === "file" ? "file" : "console";
  return {
    audit: {
      enabled: true,
      sink,
      filePath: process.env["PROXY_LOG_PATH"] ?? "./proxy-audit.jsonl",
    },
    interceptors: {
      promptInjection: {
        enabled: envEnabled("PROXY_INJECTION_CHECK", true),
        action: process.env["PROXY_MODE"] === "warn" ? "warn" : "block",
      },
      toolResultInjection: {
        enabled: envEnabled("PROXY_RESULT_CHECK", true),
        action: process.env["PROXY_MODE"] === "warn" ? "warn" : "block",
      },
      definitionDrift: {
        enabled: envEnabled("PROXY_DRIFT_CHECK", true),
        action: process.env["PROXY_MODE"] === "warn" ? "warn" : "block",
      },
      piiMasking: { enabled: envEnabled("PROXY_PII_MASK", true) },
    },
  };
}

export function loadProxyConfig(argv: string[] = process.argv): ProxyConfig {
  // 1. Config file: GUARDBEE_PROXY_CONFIG env or ./guardbee-proxy.json
  const configPath =
    process.env["GUARDBEE_PROXY_CONFIG"] ??
    path.join(process.cwd(), "guardbee-proxy.json");

  const fileConfig = parseConfigFile(configPath);
  if (fileConfig) return fileConfig;

  const runtime = runtimeFromEnv();

  // 2. CLI args: guardbee-proxy -- <command> [args]
  const fromArgs = parseServerFromArgs(argv);
  if (fromArgs) {
    return { server: fromArgs, ...runtime };
  }

  // 3. Env vars
  const fromEnv = parseServerFromEnv();
  if (fromEnv) {
    return { server: fromEnv, ...runtime };
  }

  throw new Error(
    "No proxy target configured. Use: guardbee-proxy -- <command> [args]\n" +
      "Or create a guardbee-proxy.json config file."
  );
}
