import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { AuditLogger, verifyAuditChain } from "../audit/logger.js";
import { runInit } from "../init.js";
import { renderMarkdown } from "../report/render.js";
import { buildReport, signReport } from "../report/report.js";

// #309: servers that init leaves outside the proxy (SSE, disabled) bypass the
// policy; they must show up in the security report, not only in a terminal.
function setup(servers: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-bypass-"));
  const client = path.join(dir, "mcp.json");
  fs.writeFileSync(client, JSON.stringify({ mcpServers: servers }));
  return { dir, client, yaml: path.join(dir, "guardbee-proxy.yaml"), audit: path.join(dir, "guardbee-audit.jsonl") };
}

const report = (file: string, to = new Date("2027-01-01T00:00:00Z")) =>
  buildReport(fs.readFileSync(file, "utf8"), { from: new Date("2026-11-01T00:00:00Z"), to, file });

describe("servers outside the proxy", () => {
  it("init records what it left out; the report lists it", () => {
    const { client, yaml, audit } = setup({
      fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
      legacy: { type: "sse", url: "https://mcp.example.com/sse" },
      off: { command: "npx", args: ["-y", "some-server"], disabled: true },
    });
    runInit({ clientConfigPath: client, yamlPath: yaml, now: new Date("2026-11-18T10:00:00Z") });

    expect(fs.statSync(audit).mode & 0o777).toBe(0o600);
    expect(verifyAuditChain(fs.readFileSync(audit, "utf8"))).toEqual({ ok: true, events: 3 });
    const r = report(audit);
    expect(r.unprotected?.map((u) => u.server).sort()).toEqual(["legacy", "off"]);
    expect(r.unprotected?.find((u) => u.server === "legacy")?.reason).toContain("SSE");

    const md = renderMarkdown(signReport(r), "en");
    expect(md).toContain("MCP servers outside the proxy");
    expect(md).toContain("`legacy`");
  });

  it("is still listed in a later period, until a newer init run leaves nothing out", async () => {
    const { client, yaml, audit } = setup({
      fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
      legacy: { type: "sse", url: "https://mcp.example.com/sse" },
    });
    runInit({ clientConfigPath: client, yamlPath: yaml, now: new Date("2026-11-01T10:00:00Z") });

    // The proxy writes to the same log afterwards; the chain goes on
    const logger = new AuditLogger({ enabled: true, sink: "file", filePath: audit });
    logger.log({ ts: "2026-11-20T00:00:00Z", type: "tool_call", tool: "fs__read_file" });
    await logger.close();
    expect(verifyAuditChain(fs.readFileSync(audit, "utf8")).ok).toBe(true);

    const december = buildReport(fs.readFileSync(audit, "utf8"), { from: new Date("2026-12-01T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z"), file: audit });
    expect(december.unprotected?.map((u) => u.server)).toEqual(["legacy"]);

    // The SSE server moved to /mcp: init runs again and leaves nothing out
    fs.writeFileSync(client, JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }, legacy: { url: "https://mcp.example.com/mcp" } } }));
    runInit({ clientConfigPath: client, yamlPath: yaml, force: true, now: new Date("2026-12-10T10:00:00Z") });
    expect(report(audit).unprotected).toBeUndefined();
    // A report for a period before the fix still shows the state of then
    expect(report(audit, new Date("2026-12-05T00:00:00Z")).unprotected?.map((u) => u.server)).toEqual(["legacy"]);
    expect(verifyAuditChain(fs.readFileSync(audit, "utf8")).ok).toBe(true);
  });

  it("dry run writes nothing to the audit log", () => {
    const { client, yaml, audit } = setup({ fs: { command: "npx", args: ["x"] }, legacy: { type: "sse", url: "https://a.example/sse" } });
    runInit({ clientConfigPath: client, yamlPath: yaml, dryRun: true });
    expect(fs.existsSync(audit)).toBe(false);
  });
});
