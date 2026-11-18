import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import { runInit } from "../init.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

// #309: credentials must not leak through the audit log, tool results, the
// approval state or the files init writes.
// Random, not a real token; assembled at runtime so the repo's secret scan does not flag this file.
const TOKEN = ["ghp", "u8jzPde0IgxLd6GncfBAepfJBd0Kh8oOOL8d"].join("_");

async function logged(includePayloads: boolean, events: Parameters<AuditLogger["log"]>[0][]): Promise<string> {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gb-leak-")), "audit.jsonl");
  const logger = new AuditLogger({ enabled: true, sink: "file", filePath, includePayloads });
  for (const event of events) logger.log(event);
  await logger.close();
  return fs.readFileSync(filePath, "utf8");
}

describe("secret leakage", () => {
  it("audit log with payloads: credentials are masked, personal data is kept for its owner", async () => {
    const text = await logged(true, [
      { ts: "2026-11-18T00:00:00Z", type: "tool_call", tool: "deploy__set_env", input: { name: "GITHUB_TOKEN", value: TOKEN, owner: "TC 10000000146" } },
      { ts: "2026-11-18T00:00:01Z", type: "tool_response", tool: "vault__read", output: { content: [{ type: "text", text: `token=${TOKEN}` }] } },
    ]);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("10000000146");
    expect(text).toContain("deploy__set_env");
  });

  it("audit log without payloads (default): neither the arguments nor the result are written", async () => {
    const text = await logged(false, [{ ts: "2026-11-18T00:00:00Z", type: "tool_call", tool: "t", input: { value: TOKEN }, output: { text: TOKEN } }]);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("inputHash");
  });

  it("a credential in a tool result is masked before the agent sees it", async () => {
    const vault = fakeUpstream("vault", [{ name: "read", returns: `the deploy key is ${TOKEN}` }]);
    const gateway = new Gateway([vault], gatewayConfig(), new AuditLogger({ enabled: false }));
    const result = await gateway.callTool("vault__read", {});
    expect(textOf(result)).not.toContain(TOKEN);
  });

  it("an upstream error that quotes a credential reaches neither the agent nor stderr verbatim", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const broken = {
      ...fakeUpstream("broken", [{ name: "call" }]),
      callTool: async () => {
        throw new Error(`auth failed for ${TOKEN}`);
      },
    };
    const gateway = new Gateway([broken], gatewayConfig(), new AuditLogger({ enabled: true, sink: "console", includePayloads: false }));
    const result = await gateway.callTool("broken__call", {}).catch((err: unknown) => ({ isError: true, content: [{ type: "text", text: String(err) }] }));
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).not.toContain(TOKEN);
    stderr.mockRestore();
  });

  it("init: the proxy config and the client backup are readable by their owner only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-init-"));
    const client = path.join(dir, "claude_desktop_config.json");
    fs.writeFileSync(client, JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: TOKEN } } } }), { mode: 0o644 });
    const yaml = path.join(dir, "guardbee-proxy.yaml");
    const result = runInit({ clientConfigPath: client, yamlPath: yaml });
    expect(fs.statSync(yaml).mode & 0o777).toBe(0o600);
    expect(fs.statSync(result.backupPath!).mode & 0o777).toBe(0o600);
    // The rewritten client config only points at the proxy: the token left it
    expect(fs.readFileSync(client, "utf8")).not.toContain(TOKEN);
  });
});
