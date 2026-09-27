import { afterEach, describe, expect, it } from "vitest";
import { loadProxyConfig } from "../config.js";

const ENV_KEYS = [
  "GUARDBEE_PROXY_CONFIG",
  "PROXY_COMMAND",
  "PROXY_ARGS",
  "PROXY_MODE",
  "PROXY_LOG",
  "PROXY_LOG_PATH",
  "PROXY_PII_MASK",
  "PROXY_INJECTION_CHECK",
  "PROXY_RESULT_CHECK",
  "PROXY_DRIFT_CHECK",
] as const;

const saved: Record<string, string | undefined> = {};

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) setEnv(key, saved[key]);
});

describe("loadProxyConfig", () => {
  it("applies PROXY_* settings when the target comes from the environment", () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    setEnv("GUARDBEE_PROXY_CONFIG", "/tmp/guardbee-proxy-missing.json");
    setEnv("PROXY_COMMAND", "npx");
    setEnv("PROXY_ARGS", "some-server --flag");
    setEnv("PROXY_MODE", "warn");
    setEnv("PROXY_LOG", "file");
    setEnv("PROXY_LOG_PATH", "/tmp/audit.jsonl");
    setEnv("PROXY_PII_MASK", "0");
    setEnv("PROXY_INJECTION_CHECK", "false");

    const cfg = loadProxyConfig(["node", "cli.js"]);
    expect(cfg.server).toEqual({ command: "npx", args: ["some-server", "--flag"] });
    expect(cfg.audit).toEqual({ enabled: true, sink: "file", filePath: "/tmp/audit.jsonl" });
    expect(cfg.interceptors?.promptInjection).toEqual({ enabled: false, action: "warn" });
    expect(cfg.interceptors?.toolResultInjection).toEqual({ enabled: true, action: "warn" });
    expect(cfg.interceptors?.definitionDrift).toEqual({ enabled: true, action: "warn" });
    expect(cfg.interceptors?.piiMasking).toEqual({ enabled: false });
  });
});
