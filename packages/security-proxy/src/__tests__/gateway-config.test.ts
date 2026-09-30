import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { fromLegacyConfig, loadGatewayConfig, parseGatewayYaml } from "../gateway/config.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

const minimal = `
version: 1
upstreams:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env: { GITHUB_TOKEN: "\${TEST_GH_TOKEN}" }
`;

describe("parseGatewayYaml", () => {
  it("fills safe defaults: strict taint, allow, no payloads in the audit log", () => {
    process.env["TEST_GH_TOKEN"] = "ghp_test";
    const cfg = parseGatewayYaml(minimal);
    expect(cfg.namespaced).toBe(true);
    expect(cfg.taint).toEqual({ mode: "strict" });
    expect(cfg.defaults).toEqual({ action: "allow" });
    expect(cfg.audit).toEqual({ enabled: true, sink: "console", includePayloads: false });
    expect(cfg.upstreams["github"]).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "ghp_test" },
    });
  });

  it("fails loudly when a referenced env var is missing", () => {
    delete process.env["TEST_GH_TOKEN"];
    expect(() => parseGatewayYaml(minimal)).toThrow("TEST_GH_TOKEN");
  });

  it("reads labels, rules and taint mode", () => {
    const cfg = parseGatewayYaml(`
version: 1
upstreams: { db: { command: node, args: [db.js] } }
labels:
  db__query: [sensitive]
rules:
  - id: no-deletes
    match: { tool: "db__delete_*" }
    action: deny
taint: { mode: warn }
`);
    expect(cfg.labels).toEqual({ db__query: ["sensitive"] });
    expect(cfg.rules).toEqual([{ id: "no-deletes", match: { tool: "db__delete_*" }, action: "deny" }]);
    expect(cfg.taint.mode).toBe("warn");
  });

  it.each([
    ["an unknown action", "rules: [{ match: {}, action: quarantine }]", "rules.0.action"],
    ["an unknown label", "labels: { db__q: [secret] }", "labels.db__q.0"],
    ["a typo'd key", "taint: { mod: strict }", "taint"],
    ["an HTTP upstream", "", "not supported yet"],
  ])("rejects %s", (_, extra, expected) => {
    const upstreams = expected === "not supported yet" ? "upstreams: { web: { url: https://x } }" : "upstreams: { db: { command: node } }";
    expect(() => parseGatewayYaml(`version: 1\n${upstreams}\n${extra}`)).toThrow(expected);
  });

  it("rejects upstream names containing the __ separator", () => {
    expect(() => parseGatewayYaml("version: 1\nupstreams: { a__b: { command: node } }")).toThrow("namespace separator");
  });
});

describe("loadGatewayConfig", () => {
  it("prefers --config, then falls back to the legacy JSON / -- <command> setup", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-proxy-"));
    const file = path.join(dir, "proxy.yaml");
    fs.writeFileSync(file, "version: 1\nupstreams: { a: { command: node } }\n");
    delete process.env["GUARDBEE_PROXY_CONFIG"];

    expect(Object.keys(loadGatewayConfig(["node", "cli", "--config", file], dir).upstreams)).toEqual(["a"]);

    process.env["GUARDBEE_PROXY_CONFIG"] = path.join(dir, "missing.json");
    const legacy = loadGatewayConfig(["node", "cli", "--", "npx", "some-server"], dir);
    expect(legacy.namespaced).toBe(false);
    expect(legacy.upstreams["default"]).toEqual({ command: "npx", args: ["some-server"] });
  });

  it("picks up ./guardbee-proxy.yaml without flags", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-proxy-"));
    fs.writeFileSync(path.join(dir, "guardbee-proxy.yaml"), "version: 1\nupstreams: { b: { command: node } }\n");
    delete process.env["GUARDBEE_PROXY_CONFIG"];
    expect(Object.keys(loadGatewayConfig(["node", "cli"], dir).upstreams)).toEqual(["b"]);
  });

  it("errors when --config points at a missing file", () => {
    expect(() => loadGatewayConfig(["node", "cli", "--config", "/nope/x.yaml"], os.tmpdir())).toThrow("not found");
  });
});

describe("fromLegacyConfig", () => {
  it("keeps 0.x behavior: plain names, payloads logged, toxic flow only warns", () => {
    const cfg = fromLegacyConfig({ server: { command: "npx" }, audit: { enabled: true, sink: "console" } });
    expect(cfg.namespaced).toBe(false);
    expect(cfg.taint.mode).toBe("warn");
    expect(cfg.audit.includePayloads).toBe(true);
  });
});
