import { describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import type { GatewayConfig } from "../gateway/config.js";
import { Gateway } from "../gateway/gateway.js";
import type { Upstream } from "../gateway/upstream.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig } from "./fakes.js";

function recording(upstreams: Upstream[], overrides: Partial<GatewayConfig> = {}) {
  const events: AuditEvent[] = [];
  const audit = { log: (event: AuditEvent) => events.push(event) } as unknown as AuditLogger;
  return { gw: new Gateway(upstreams, gatewayConfig(overrides), audit), events };
}

const responses = (events: AuditEvent[]) => events.filter((e) => e.type === "tool_response" || e.type === "resource_read");

describe("piiHits on audit events", () => {
  it("counts personal data by category, never the values", async () => {
    const crm = fakeUpstream("crm", [
      { name: "get_customer", returns: "Ayşe, TC 10000000146, ayse@example.com, yedek ayse.k@example.org, TR33 0006 1005 1978 6457 8413 26" },
    ]);
    const { gw, events } = recording([crm]);
    await gw.callTool("crm__get_customer", {});
    const [event] = responses(events);
    expect(event?.piiHits).toEqual({ tc_kimlik: 1, email: 2, iban: 1 });
    expect(JSON.stringify(events)).not.toContain("10000000146");
  });

  it("groups credentials under secret", async () => {
    const ops = fakeUpstream("ops", [{ name: "env", returns: "GITHUB_TOKEN=ghp_" + "a".repeat(36) }]);
    const { gw, events } = recording([ops]);
    await gw.callTool("ops__env", {});
    expect(responses(events)[0]?.piiHits).toEqual({ secret: 1 });
  });

  it("does not double count structuredContent that repeats the text", async () => {
    const db = fakeUpstream("db", [{ name: "query", returns: '{"tc":"10000000146"}', structured: { tc: "10000000146" } }]);
    const { gw, events } = recording([db]);
    await gw.callTool("db__query", {});
    expect(responses(events)[0]?.piiHits).toEqual({ tc_kimlik: 1 });
  });

  it("still counts when masking is off — the report is about what the model saw", async () => {
    const crm = fakeUpstream("crm", [{ name: "get_customer", returns: "ayse@example.com" }]);
    const { gw, events } = recording([crm], { interceptors: { piiMasking: { enabled: false } } });
    await gw.callTool("crm__get_customer", {});
    expect(responses(events)[0]?.piiHits).toEqual({ email: 1 });
  });

  it("counts resources and leaves clean responses without the field", async () => {
    const up = fakeUpstream("files", [{ name: "ping", returns: "pong" }], [
      { uri: "file:///notes.txt", name: "notes", text: "call 0532 123 45 67" },
    ]);
    const { gw, events } = recording([up]);
    await gw.callTool("files__ping", {});
    await gw.readResource("file:///notes.txt");
    const [ping, resource] = responses(events);
    expect(ping).not.toHaveProperty("piiHits");
    expect(resource?.piiHits).toEqual({ phone_tr: 1 });
  });
});
