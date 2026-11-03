import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GuardBeeApiError, GuardBeeClient, type Remediation } from "../client.js";
import { formatFix, formatVerification } from "../format.js";
import { detectStack, readProjectFile } from "../stack.js";

describe("GuardBeeClient", () => {
  it("calls the v1 remediation endpoints with the API key and MCP client header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: { id: "rem-1", appliedRef: "abc123" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new GuardBeeClient("gb_key", "https://app.example/", fake);
    await client.proposeFix("run 1", { findingId: "f1", platform: "nginx" });
    await client.reportApplied("rem-1", "abc123");
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", "https://app.example/api/v1/security-agent/runs/run%201/remediations"],
      ["POST", "https://app.example/api/v1/remediations/rem-1/applied"],
    ]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer gb_key");
    expect(headers["X-GuardBee-Client"]).toBe("mcp-security-engineer");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ ref: "abc123" });
  });

  it("surfaces API errors with status and code", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: "Apply the fix first", code: "NOT_APPLIED" }), { status: 409 })) as unknown as typeof fetch;
    await expect(new GuardBeeClient("k", undefined, fake).verify("r")).rejects.toMatchObject({ status: 409, code: "NOT_APPLIED" });
    await expect(new GuardBeeClient("k", undefined, fake).verify("r")).rejects.toBeInstanceOf(GuardBeeApiError);
  });
});

describe("detectStack (local repository)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gb-stack-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "15.5.0" } }));
    mkdirSync(join(dir, "deploy"));
    writeFileSync(join(dir, "deploy", "nginx.conf"), "server {\n    listen 443 ssl;\n}\n");
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "x", "nginx.conf"), "ignored");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds the framework and web server config, skipping node_modules", async () => {
    expect(await detectStack(dir)).toEqual([
      { platform: "nextjs", evidence: "package.json depends on next@15.5.0" },
      { platform: "nginx", evidence: "deploy/nginx.conf found", configFile: "deploy/nginx.conf" },
    ]);
  });

  it("reads config files only inside the project root", async () => {
    expect(await readProjectFile(dir, "deploy/nginx.conf")).toContain("listen 443");
    await expect(readProjectFile(dir, "../../etc/passwd")).rejects.toThrow(/outside the project root/);
  });
});

describe("formatting", () => {
  const rem: Remediation = {
    id: "rem-1", findingId: "f1", platform: "nginx", status: "PROPOSED", appliedRef: null, verification: null,
    proposal: {
      title: "Set the Content-Security-Policy header", platformLabel: "Nginx", strategy: "Add the header", steps: ["Reload Nginx."],
      code: [{ title: "nginx", language: "nginx", code: "add_header Content-Security-Policy \"default-src 'self'\" always;" }],
      changes: [], configDiff: "--- a/nginx.conf\n+++ b/nginx.conf\n+    add_header X;", configDiffNote: null, caveats: ["Test with Report-Only first."],
      verification: { moduleId: "csp", description: "Re-run the CSP check." },
    },
  };

  it("tells the coding agent to edit, get approval, report and verify", () => {
    const text = formatFix(rem);
    expect(text).toContain("```diff");
    expect(text).toContain("let them approve it");
    expect(text).toContain('report_applied with remediationId="rem-1"');
    expect(text).toContain('verify_fix with remediationId="rem-1"');
  });

  it("reports verification outcomes", () => {
    expect(formatVerification({ ...rem, verification: { outcome: "resolved", detail: "gone", checkedAt: "2026-11-03" } })).toContain("✅ Resolved");
    expect(formatVerification({ ...rem, verification: { outcome: "still_present", detail: "still", checkedAt: "2026-11-03" } })).toContain("deployed?");
  });
});
