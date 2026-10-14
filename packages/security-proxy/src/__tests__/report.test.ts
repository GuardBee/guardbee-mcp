import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { generateKeyPairSync } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../audit/logger.js";
import { buildReport, signReport, verifyReport } from "../report/report.js";
import { extractSigned, renderHtml, renderMarkdown } from "../report/render.js";
import type { AuditEvent } from "../types.js";

let dir: string;
let log: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-report-"));
  log = path.join(dir, "audit.jsonl");
  const audit = new AuditLogger({ enabled: true, sink: "file", filePath: log, includePayloads: false });
  const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
  const events: Omit<AuditEvent, "hash" | "prevHash">[] = [
    { ts: at(1), type: "tool_call", tool: "github__get_issue", sessionId: "s1", user: "alice" },
    { ts: at(2), type: "tool_response", tool: "crm__get_customer", sessionId: "s1", piiHits: { tc_kimlik: 2, email: 1 } },
    { ts: at(3), type: "blocked", tool: "github__get_issue", reason: "Indirect prompt injection in tool result (MCP06:2025): ignore_previous", sessionId: "s1" },
    { ts: at(4), type: "toxic_flow", tool: "github__create_pull_request", reason: "Toxic flow (lethal trifecta): untrusted … sensitive …", sessionId: "s1" },
    { ts: at(5), type: "blocked", tool: "mail__send", ruleId: "egress:credential", reason: "credential in the arguments", sessionId: "s2", user: "bob" },
    { ts: at(20), type: "blocked", tool: "mail__send", ruleId: "no-mail", reason: "denied by policy rule no-mail", sessionId: "s3" },
    { ts: "2026-09-15T00:00:00.000Z", type: "blocked", tool: "old", ruleId: "old" },
  ];
  for (const event of events) audit.log(event as AuditEvent);
  await audit.close();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const october = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z"), file: "audit.jsonl", now: new Date("2026-11-01T08:00:00Z") };

describe("buildReport", () => {
  it("summarises the period and maps findings to OWASP LLM and MITRE ATLAS", () => {
    const report = buildReport(fs.readFileSync(log, "utf8"), october);
    expect(report.totals).toEqual({ events: 6, toolCalls: 1, blocked: 3, warnings: 0, toxicFlows: 1, approvals: 0, sessions: 3, users: 2 });
    expect(report.source.chain.ok).toBe(true);
    expect(report.source.lastHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.personalData).toEqual({ tc_kimlik: 2, email: 1 });
    const byId = Object.fromEntries(report.categories.map((c) => [c.id, c]));
    expect(byId["indirect-injection"]!.owasp.map((o) => o.id)).toContain("LLM01:2025");
    expect(byId["indirect-injection"]!.atlas.map((a) => a.id)).toEqual(["AML.T0051.001"]);
    expect(byId["data-leak"]).toMatchObject({ events: 2, blocked: 2 });
    expect(byId["excessive-agency"]!.events).toBe(1);
    expect(report.topRules).toEqual([
      { ruleId: "egress:credential", count: 1 },
      { ruleId: "no-mail", count: 1 },
    ]);
  });

  it("notices a broken audit chain", () => {
    const lines = fs.readFileSync(log, "utf8").split("\n");
    lines.splice(2, 1);
    expect(buildReport(lines.join("\n"), october).source.chain.ok).toBe(false);
  });
});

describe("signing", () => {
  const keys = () => generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

  it("signs with Ed25519, verifies, and catches an edit or another key", () => {
    const { privateKey, publicKey } = keys();
    const signed = signReport(buildReport(fs.readFileSync(log, "utf8"), october), privateKey);
    expect(verifyReport(signed)).toEqual({ ok: true, signed: true });
    expect(verifyReport(signed, publicKey)).toEqual({ ok: true, signed: true });

    const edited = structuredClone(signed);
    edited.report.totals.blocked = 0;
    expect(verifyReport(edited)).toMatchObject({ ok: false, reason: expect.stringContaining("changed") });

    // An attacker re-signs an edited report with their own key: only a pinned key catches it
    const forged = signReport(edited.report, keys().privateKey);
    expect(verifyReport(forged).ok).toBe(true);
    expect(verifyReport(forged, publicKey)).toMatchObject({ ok: false, reason: expect.stringContaining("different key") });
    expect(verifyReport(signReport(signed.report), publicKey)).toMatchObject({ ok: false, reason: "the report is not signed" });
    expect(() => signReport(signed.report, generateKeyPairSync("rsa", { modulusLength: 1024, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey)).toThrow(/Ed25519/);
  });

  it("the signed report survives the round trip through HTML and Markdown", () => {
    const signed = signReport(buildReport(fs.readFileSync(log, "utf8"), october), keys().privateKey);
    const html = renderHtml(signed, "tr");
    expect(html).toContain("GuardBee güvenlik raporu");
    expect(html).toContain("AML.T0051.001");
    expect(verifyReport(extractSigned(html))).toEqual({ ok: true, signed: true });
    const md = renderMarkdown(signed, "en");
    expect(md).toContain("| Instructions hidden in tool results, resources and prompts | LLM01:2025 Prompt Injection; LLM05:2025 Improper Output Handling | AML.T0051.001 LLM Prompt Injection: Indirect | 1 | 1 |");
    expect(verifyReport(extractSigned(md))).toEqual({ ok: true, signed: true });
  });
});

describe("CLI", () => {
  const bin = path.join(__dirname, "..", "..", "dist", "cli.js");
  it.skipIf(!fs.existsSync(bin))("report --key then verify-report --pubkey", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    fs.writeFileSync(path.join(dir, "key.pem"), privateKey);
    fs.writeFileSync(path.join(dir, "pub.pem"), publicKey);
    const out = path.join(dir, "report.html");
    execFileSync(process.execPath, [bin, "report", log, "--from", "2026-10-01", "--to", "2026-11-01", "--key", path.join(dir, "key.pem"), "--out", out, "--lang", "tr"]);
    expect(execFileSync(process.execPath, [bin, "verify-report", out, "--pubkey", path.join(dir, "pub.pem")]).toString()).toContain("OK: signature valid (trusted key)");
    fs.writeFileSync(out, fs.readFileSync(out, "utf8").replace('"blocked":3', '"blocked":0'));
    const tampered = spawnSync(process.execPath, [bin, "verify-report", out, "--pubkey", path.join(dir, "pub.pem")]);
    expect(tampered.status).toBe(1);
    expect(tampered.stdout.toString()).toContain("FAILED");
  }, 30_000); // three node processes; CI runners are slower than a laptop
});
