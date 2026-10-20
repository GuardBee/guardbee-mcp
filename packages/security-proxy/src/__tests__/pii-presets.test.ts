import { describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

// A fake GitHub token, assembled so secret scanners do not flag the source
const KEY = ["ghp", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY2zAb"].join("_");
const ROW = `TC 10000000146, ayse@example.com, token ${KEY}`;

function setup(interceptors: GatewayConfig["interceptors"]) {
  const events: AuditEvent[] = [];
  const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
  const crm = fakeUpstream("crm", [{ name: "get_customer", returns: ROW }]);
  const ops = fakeUpstream("ops", [{ name: "env", returns: ROW }]);
  return { gw: new Gateway([crm, ops], gatewayConfig({ interceptors }), audit), events };
}

describe("piiMasking preset / enable / disable", () => {
  it("masks only the preset's detectors and still counts everything it finds", async () => {
    const { gw, events } = setup({ piiMasking: { enabled: true, preset: "SECRETS" } });
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toBe("TC 10000000146, ayse@example.com, token [API-KEY]");
    expect(events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ secret: 1, tc_kimlik: 1, email: 1 });
  });

  it("disable drops a detector from the default set", async () => {
    const { gw } = setup({ piiMasking: { enabled: true, disable: ["email"] } });
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toBe("TC [TC-KİMLİK], ayse@example.com, token [API-KEY]");
  });

  it("a per-upstream selection replaces the global one for that upstream only", async () => {
    const { gw } = setup({ piiMasking: { enabled: true, preset: "KVKK", upstreams: { ops: { preset: "SECRETS" } } } });
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toBe(`TC [TC-KİMLİK], ***@[EMAIL], token ${KEY}`);
    expect(textOf(await gw.callTool("ops__env", {}))).toBe("TC 10000000146, ayse@example.com, token [API-KEY]");
  });

  it("tokenize mode tokenizes only the selected detectors", async () => {
    const { gw } = setup({ piiMasking: { enabled: true, mode: "tokenize", preset: "IDENTIFIERS", disable: ["email"] } });
    await gw.listTools();
    const text = textOf(await gw.callTool("crm__get_customer", {}));
    expect(text).toMatch(/^TC <pii:tc_kimlik:[0-9a-f]{8}>, ayse@example.com, token ghp_/);
  });

  it("enable turns on an opt-in detector, like the older include list", async () => {
    const events: AuditEvent[] = [];
    const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
    const net = fakeUpstream("net", [{ name: "hosts", returns: "db 10.0.3.17, TC 10000000146" }]);
    const gw = new Gateway([net], gatewayConfig({ interceptors: { piiMasking: { enabled: true, preset: "SECRETS", enable: ["ip_address"] } } }), audit);
    await gw.listTools();
    expect(textOf(await gw.callTool("net__hosts", {}))).toBe("db [IP], TC 10000000146");
  });
});

describe("piiMasking selection in guardbee-proxy.yaml", () => {
  const yaml = (masking: string) => `version: 1
upstreams:
  crm: { command: node, args: [crm.js] }
interceptors:
  piiMasking:
${masking}`;

  it("accepts a preset, enable / disable and a per-upstream override", () => {
    const cfg = parseGatewayYaml(yaml("    enabled: true\n    preset: KVKK\n    disable: [address]\n    upstreams:\n      crm: { preset: SECRETS, enable: [email] }"));
    expect(cfg.interceptors.piiMasking).toMatchObject({ preset: "KVKK", disable: ["address"], upstreams: { crm: { preset: "SECRETS", enable: ["email"] } } });
  });

  it("rejects an unknown preset, detector name or upstream", () => {
    expect(() => parseGatewayYaml(yaml("    enabled: true\n    preset: GDPR"))).toThrow(/preset/);
    expect(() => parseGatewayYaml(yaml("    enabled: true\n    enable: [tckn]"))).toThrow('unknown PII detector "tckn"');
    expect(() => parseGatewayYaml(yaml("    enabled: true\n    upstreams:\n      crm: { disable: [mail] }"))).toThrow('unknown PII detector "mail"');
    expect(() => parseGatewayYaml(yaml("    enabled: true\n    upstreams:\n      billing: { preset: SECRETS }"))).toThrow('no upstream or LLM provider named "billing"');
  });
});

describe("preset KVKK_SENSITIVE (KVKK Art. 6)", () => {
  it("masks special-category terms in a result about a person, and counts them as personal data", async () => {
    const events: AuditEvent[] = [];
    const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
    const hr = fakeUpstream("hr", [{ name: "get_employee", returns: "Çalışan TC 10000000146, migren nedeniyle raporlu; sendika üyesi." }]);
    const gw = new Gateway([hr], gatewayConfig({ interceptors: { piiMasking: { enabled: true, preset: "KVKK_SENSITIVE" } } }), audit);
    await gw.listTools();
    expect(textOf(await gw.callTool("hr__get_employee", {}))).toBe("Çalışan TC [TC-KİMLİK], [SAĞLIK] nedeniyle raporlu; [SENDİKA].");
    expect(events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ tc_kimlik: 1, health: 1, union_membership: 1 });
  });

  it("accepts the preset and the category names in the config file", () => {
    const yaml = "version: 1\nupstreams:\n  hr:\n    command: hr-mcp\ninterceptors:\n  piiMasking:\n    enabled: true\n    preset: KVKK\n    enable: [health, genetic]\n    upstreams:\n      hr: { preset: KVKK_SENSITIVE, disable: [religion_belief] }\n";
    expect(() => parseGatewayYaml(yaml)).not.toThrow();
  });
});
