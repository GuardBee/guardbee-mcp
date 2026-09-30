import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { AuditLogger, verifyAuditChain } from "../audit/logger.js";

function tempLog(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gb-audit-")), "audit.jsonl");
}

async function write(filePath: string, count: number, includePayloads = false): Promise<void> {
  const logger = new AuditLogger({ enabled: true, sink: "file", filePath, includePayloads });
  for (let i = 0; i < count; i++) {
    logger.log({ ts: `2026-09-30T00:00:0${i}Z`, type: "tool_call", tool: `t${i}`, input: { tc: "10000000146", i } });
  }
  await new Promise<void>((resolve) => {
    logger["stream"]?.end(resolve);
  });
}

describe("audit hash chain", () => {
  it("verifies an untouched log, including across a restart", async () => {
    const file = tempLog();
    await write(file, 3);
    await write(file, 2);
    expect(verifyAuditChain(fs.readFileSync(file, "utf8"))).toEqual({ ok: true, events: 5 });
  });

  it("detects an edited line", async () => {
    const file = tempLog();
    await write(file, 3);
    const edited = fs.readFileSync(file, "utf8").replace('"tool":"t1"', '"tool":"tX"');
    expect(verifyAuditChain(edited)).toMatchObject({ ok: false, line: 2 });
  });

  it("detects a deleted line", async () => {
    const file = tempLog();
    await write(file, 3);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.splice(1, 1);
    expect(verifyAuditChain(lines.join("\n"))).toMatchObject({ ok: false, line: 2 });
  });

  it("stores only a hash of the arguments when payloads are off", async () => {
    const file = tempLog();
    await write(file, 1);
    const event = JSON.parse(fs.readFileSync(file, "utf8").trim());
    expect(event.input).toBeUndefined();
    expect(event.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(file, "utf8")).not.toContain("10000000146");
  });

  it("keeps raw arguments when payloads are on (legacy default)", async () => {
    const file = tempLog();
    await write(file, 1, true);
    expect(JSON.parse(fs.readFileSync(file, "utf8").trim()).input).toEqual({ tc: "10000000146", i: 0 });
  });
});
