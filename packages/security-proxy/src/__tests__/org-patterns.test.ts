import { describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

const ROW = "Müşteri CL-123456 (yedek CL-654321), destek@acme.com.tr ve ayse@example.com";

function setup(interceptors: GatewayConfig["interceptors"], returns = ROW) {
  const events: AuditEvent[] = [];
  const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
  const crm = fakeUpstream("crm", [{ name: "get_customer", returns }]);
  return { gw: new Gateway([crm], gatewayConfig({ interceptors }), audit), events };
}

const masking = (extra: object) => ({ piiMasking: { enabled: true, ...extra } });

describe("org patterns in the MCP gateway", () => {
  it("block patterns mask the org's own ids and count under their category", async () => {
    const { gw, events } = setup(masking({ blockPatterns: [{ pattern: "CL-\\d{6}", category: "CLIENT_NO" }] }));
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toBe("Müşteri <CLIENT_NO_1> (yedek <CLIENT_NO_2>), ***@[EMAIL] ve ***@[EMAIL]");
    expect(events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ email: 2, CLIENT_NO: 2 });
  });

  it("block patterns apply whatever the preset", async () => {
    const { gw } = setup(masking({ preset: "SECRETS", blockPatterns: [{ pattern: "CL-\\d{6}", category: "CLIENT_NO" }] }));
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toBe("Müşteri <CLIENT_NO_1> (yedek <CLIENT_NO_2>), destek@acme.com.tr ve ayse@example.com");
  });

  it("an allow pattern keeps a detected value, is not counted, and is flagged in the audit log", async () => {
    const { gw, events } = setup(masking({ allowPatterns: ["destek@acme\\.com\\.tr"] }));
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toBe("Müşteri CL-123456 (yedek CL-654321), destek@acme.com.tr ve ***@[EMAIL]");
    expect(events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ email: 1 });
    expect(events.filter((e) => e.ruleId === "pii:allow")).toEqual([
      expect.objectContaining({ type: "warn", tool: "crm__get_customer", upstream: "crm", reason: 'allow pattern "destek@acme\\\\.com\\\\.tr" kept a email value unmasked' }),
    ]);
  });

  it("tokenize mode gives org categories lower-case tokens", async () => {
    const { gw } = setup(masking({ mode: "tokenize", blockPatterns: [{ pattern: "CL-\\d{6}", category: "CLIENT_NO" }] }), "dosya CL-123456");
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toMatch(/^dosya <pii:client_no:[0-9a-f]{8}>$/);
  });

  it("a block pattern over its time budget withholds the result", async () => {
    const { gw, events } = setup(masking({ blockPatterns: ["(a+)+b"] }), "a".repeat(40));
    await gw.listTools();
    await expect(gw.callTool("crm__get_customer", {})).rejects.toThrow(/Result withheld: block pattern/);
    expect(events.some((e) => e.type === "blocked" && e.ruleId === "pii:pattern-timeout")).toBe(true);
    expect(events.some((e) => e.type === "tool_response")).toBe(false);
  });
});

describe("org patterns in guardbee-proxy.yaml", () => {
  const yaml = (body: string) => `version: 1\nupstreams:\n  crm: { command: node, args: [crm.js] }\ninterceptors:\n  piiMasking:\n    enabled: true\n${body}`;

  it("accepts block and allow patterns", () => {
    const cfg = parseGatewayYaml(yaml('    blockPatterns: ["CL-\\\\d{6}", { pattern: "SIP-\\\\d{4}", category: ORDER_NO }]\n    allowPatterns: ["destek@acme\\\\.com\\\\.tr"]'));
    expect(cfg.interceptors.piiMasking?.blockPatterns).toEqual(["CL-\\d{6}", { pattern: "SIP-\\d{4}", category: "ORDER_NO" }]);
  });

  it("rejects a category named like a built-in detector, and an invalid regex", () => {
    expect(() => parseGatewayYaml(yaml("    blockPatterns: [{ pattern: x, category: IBAN }]"))).toThrow('category "IBAN" is a built-in detector name');
    expect(() => parseGatewayYaml(yaml('    allowPatterns: ["("]'))).toThrow("invalid regular expression");
  });
});
