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

export function loadProxyConfig(): ProxyConfig {
  // 1. Config file: GUARDBEE_PROXY_CONFIG env or ./guardbee-proxy.json
  const configPath =
    process.env["GUARDBEE_PROXY_CONFIG"] ??
    path.join(process.cwd(), "guardbee-proxy.json");

  const fileConfig = parseConfigFile(configPath);
  if (fileConfig) return fileConfig;

  // 2. CLI args: guardbee-proxy -- <command> [args]
  const fromArgs = parseServerFromArgs(process.argv);
  if (fromArgs) {
    return {
      server: fromArgs,
      audit: { enabled: true, sink: "console" },
      interceptors: {
        promptInjection: { enabled: true, action: "block" },
        piiMasking: { enabled: true },
      },
    };
  }

  // 3. Env vars
  const fromEnv = parseServerFromEnv();
  if (fromEnv) {
    return {
      server: fromEnv,
      audit: { enabled: true, sink: "console" },
      interceptors: {
        promptInjection: { enabled: true, action: "block" },
        piiMasking: { enabled: true },
      },
    };
  }

  throw new Error(
    "No proxy target configured. Use: guardbee-proxy -- <command> [args]\n" +
      "Or create a guardbee-proxy.json config file."
  );
}
