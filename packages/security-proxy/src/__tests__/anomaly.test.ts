import { describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../audit/logger.js";
import type { AnomalyConfig } from "../gateway/anomaly.js";
import type { Approver } from "../gateway/approval.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import { Gateway } from "../gateway/gateway.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

const labels: GatewayConfig["labels"] = {
  crm__get_customer: ["sensitive"],
  crm__delete_customer: ["destructive"],
  crm__search: [],
  crm__export: ["egress"],
};

function setup(anomaly: AnomalyConfig | undefined, overrides: Partial<GatewayConfig> = {}, approver?: Approver) {
  let clock = 1_000_000;
  const crm = fakeUpstream("crm", [
    { name: "get_customer", returns: "customer record" },
    { name: "delete_customer", returns: "deleted" },
    { name: "search", returns: "3 results" },
    { name: "export", returns: "exported" },
  ]);
  const logger = new AuditLogger({ enabled: false, sink: "console" });
  const events: AuditEvent[] = [];
  vi.spyOn(logger, "log").mockImplementation((event) => void events.push(event));
  const gw = new Gateway(
    [crm],
    gatewayConfig({ labels, interceptors: anomaly ? { anomaly } : {}, ...overrides }),
    logger,
    approver,
    { now: () => clock },
  );
  const anomalies = () => events.filter((e) => e.ruleId?.startsWith("anomaly:"));
  return { gw, crm, anomalies, advance: (seconds: number) => void (clock += seconds * 1000) };
}

describe("anomaly checks", () => {
  it("are off unless configured", async () => {
    const { gw, crm, anomalies } = setup(undefined);
    for (let i = 0; i < 100; i++) await gw.callTool("crm__search", { q: `${i}` });
    expect(crm.calls).toHaveLength(100);
    expect(anomalies()).toEqual([]);
  });

  it("warn: logs a call burst once and lets the calls through", async () => {
    const { gw, crm, anomalies } = setup({ enabled: true, action: "warn", callBurst: { count: 3, windowSeconds: 60 } });
    for (let i = 0; i < 6; i++) await gw.callTool("crm__search", { q: `${i}` });
    expect(crm.calls).toHaveLength(6);
    expect(anomalies()).toHaveLength(1);
    expect(anomalies()[0]).toMatchObject({ type: "warn", ruleId: "anomaly:call_burst", tool: "crm__search" });
    expect(anomalies()[0]!.reason).toContain("4 tool calls in 60s (limit 3)");
  });

  it("block: refuses calls over the limit until the window slides", async () => {
    const { gw, crm, anomalies, advance } = setup({ enabled: true, action: "block", callBurst: { count: 3, windowSeconds: 60 } });
    for (let i = 0; i < 3; i++) await gw.callTool("crm__search", { q: `${i}` });
    const refused = await gw.callTool("crm__search", { q: "3" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("Anomaly (call_burst)");
    expect(crm.calls).toHaveLength(3);
    expect(anomalies()[0]).toMatchObject({ type: "blocked", ruleId: "anomaly:call_burst" });

    advance(61);
    expect((await gw.callTool("crm__search", { q: "later" })).isError).toBeFalsy();
    expect(crm.calls).toHaveLength(4);
  });

  it("counts a sweep by distinct reads, not by re-reading the same record", async () => {
    const { gw, anomalies } = setup({ enabled: true, action: "warn", sensitiveSweep: { count: 3, windowSeconds: 300 } });
    for (let i = 0; i < 10; i++) await gw.callTool("crm__get_customer", { id: 1 });
    expect(anomalies()).toEqual([]);

    for (let id = 2; id <= 4; id++) await gw.callTool("crm__get_customer", { id });
    expect(anomalies()).toHaveLength(1);
    expect(anomalies()[0]).toMatchObject({ ruleId: "anomaly:sensitive_sweep", tool: "crm__get_customer" });
    expect(anomalies()[0]!.reason).toContain("4 different reads of sensitive tools");
  });

  it("block: stops bulk destructive calls", async () => {
    const { gw, crm } = setup({ enabled: true, action: "block", destructiveBurst: { count: 2, windowSeconds: 60 } });
    await gw.callTool("crm__delete_customer", { id: 1 });
    await gw.callTool("crm__delete_customer", { id: 2 });
    const third = await gw.callTool("crm__delete_customer", { id: 3 });
    expect(textOf(third)).toContain("Anomaly (destructive_burst)");
    expect(crm.calls.map((c) => c.args["id"])).toEqual([1, 2]);
    // Ordinary calls are not destructive and go on
    expect((await gw.callTool("crm__search", { q: "x" })).isError).toBeFalsy();
  });

  it("block: locks the session after repeated policy blocks", async () => {
    const { gw, crm, anomalies } = setup(
      { enabled: true, action: "block", repeatedBlocks: { count: 2, windowSeconds: 300 } },
      { rules: [{ id: "no-export", match: { tool: "crm__export" }, action: "deny" }] },
    );
    for (let i = 0; i < 3; i++) await gw.callTool("crm__export", { to: `attempt-${i}` });
    expect(anomalies()).toEqual([
      expect.objectContaining({ type: "blocked", ruleId: "anomaly:repeated_blocks", tool: "crm__export" }),
    ]);

    // Now even an allowed tool is refused for the rest of the session
    const after = await gw.callTool("crm__search", { q: "x" });
    expect(textOf(after)).toContain("the session is locked");
    expect(crm.calls).toEqual([]);
  });

  it("warn: logs repeated blocks without locking the session", async () => {
    const { gw, crm, anomalies } = setup(
      { enabled: true, action: "warn", repeatedBlocks: { count: 2, windowSeconds: 300 } },
      { rules: [{ match: { tool: "crm__export" }, action: "deny" }] },
    );
    for (let i = 0; i < 3; i++) await gw.callTool("crm__export", {});
    expect(anomalies()).toEqual([expect.objectContaining({ type: "warn", ruleId: "anomaly:repeated_blocks" })]);
    expect((await gw.callTool("crm__search", { q: "x" })).isError).toBeFalsy();
    expect(crm.calls).toHaveLength(1);
  });

  it("counts declined approvals, but not a client that cannot show the prompt", async () => {
    const approve = { rules: [{ match: { tool: "crm__export" }, action: "approve" as const }] };
    const repeatedBlocks = { count: 1, windowSeconds: 300 };

    const unavailable = setup({ enabled: true, action: "block", repeatedBlocks }, approve);
    for (let i = 0; i < 3; i++) await unavailable.gw.callTool("crm__export", {});
    expect(unavailable.anomalies()).toEqual([]);

    const declined = setup({ enabled: true, action: "block", repeatedBlocks }, approve, async () => "declined");
    for (let i = 0; i < 2; i++) await declined.gw.callTool("crm__export", {});
    expect(declined.anomalies()).toEqual([expect.objectContaining({ ruleId: "anomaly:repeated_blocks" })]);
  });

  it("does not count its own refusals toward repeated blocks", async () => {
    const { gw, anomalies } = setup({
      enabled: true,
      action: "block",
      callBurst: { count: 1, windowSeconds: 60 },
      repeatedBlocks: { count: 1, windowSeconds: 300 },
    });
    for (let i = 0; i < 5; i++) await gw.callTool("crm__search", { q: `${i}` });
    expect(anomalies().every((e) => e.ruleId === "anomaly:call_burst")).toBe(true);
  });
});

describe("anomaly config", () => {
  const base = "version: 1\nupstreams:\n  crm:\n    command: node\n";

  it("parses from guardbee-proxy.yaml", () => {
    const config = parseGatewayYaml(
      `${base}interceptors:\n  anomaly:\n    enabled: true\n    action: block\n    callBurst: { count: 100, windowSeconds: 60 }\n`,
    );
    expect(config.interceptors.anomaly).toEqual({ enabled: true, action: "block", callBurst: { count: 100, windowSeconds: 60 } });
  });

  it("rejects a zero limit and unknown checks", () => {
    expect(() =>
      parseGatewayYaml(`${base}interceptors:\n  anomaly:\n    enabled: true\n    action: warn\n    callBurst: { count: 0, windowSeconds: 60 }\n`),
    ).toThrow(/callBurst\.count/);
    expect(() =>
      parseGatewayYaml(`${base}interceptors:\n  anomaly:\n    enabled: true\n    action: warn\n    tokenBurst: { count: 5, windowSeconds: 60 }\n`),
    ).toThrow(/tokenBurst/);
  });
});
