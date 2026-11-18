import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchQueue, type SendOutcome } from "../audit/batch-queue.js";
import type { AuditEvent } from "../types.js";

// #309: a SIEM that stays down must not lose events silently
const event = (i: number): AuditEvent => ({ ts: new Date(0).toISOString(), type: "tool_call", tool: `t${i}` });

afterEach(() => vi.restoreAllMocks());

describe("BatchQueue during an outage", () => {
  it("keeps the newest 10,000 events, warns once on overflow and reports the loss on recovery", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let up = false;
    const sent: AuditEvent[] = [];
    const queue = new BatchQueue({ name: "splunk", batchSize: 1_000_000, flushIntervalMs: 60_000 }, async (batch): Promise<SendOutcome> => {
      if (!up) throw new Error("ECONNREFUSED");
      sent.push(...batch);
      return { ok: true };
    });

    for (let i = 0; i < 10_050; i++) queue.push(event(i));
    expect(queue.pending).toBe(10_000);
    expect(queue.dropped).toBe(50);
    const warnings = () => stderr.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("splunk"));
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("oldest are being dropped");

    up = true;
    await queue.close();
    expect(sent).toHaveLength(10_000);
    expect(sent[0]!.tool).toBe("t50");
    expect(warnings()).toHaveLength(2);
    expect(warnings()[1]).toContain("50 audit events were dropped");
    expect(queue.dropped).toBe(0);
  });

  it("never makes the caller wait for the destination", () => {
    const queue = new BatchQueue({ name: "elastic", batchSize: 1 }, () => new Promise<SendOutcome>(() => {}));
    const started = performance.now();
    for (let i = 0; i < 100; i++) queue.push(event(i));
    expect(performance.now() - started).toBeLessThan(50);
  });
});
