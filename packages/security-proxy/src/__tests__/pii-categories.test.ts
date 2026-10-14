import { describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import type { GatewayConfig } from "../gateway/config.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

function setup(returns: string, interceptors: GatewayConfig["interceptors"] = {}) {
  const events: AuditEvent[] = [];
  const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
  const crm = fakeUpstream("crm", [{ name: "get_customer", returns }]);
  return { gw: new Gateway([crm], gatewayConfig({ interceptors }), audit), events };
}

describe("extended PII categories in the proxy", () => {
  it("masks and counts the label-gated categories as personal data, not credentials", async () => {
    const { gw, events } = setup("Pasaport No: U12345678\nDoğum tarihi: 12.05.1990\nKEP: acme@hs01.kep.tr\nAdres: Moda Cad. No 5 Kadıköy");
    await gw.listTools();
    const text = textOf(await gw.callTool("crm__get_customer", {}));
    expect(text).not.toContain("U12345678");
    expect(text).not.toContain("12.05.1990");
    expect(text).not.toContain("hs01.kep.tr");
    expect(text).not.toContain("Moda Cad");
    expect(events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ passport: 1, birth_date: 1, kep: 1, address: 1 });
  });

  it("leaves IPs, MACs and plates alone unless piiMasking.include lists them", async () => {
    const output = "node-1 10.0.3.17 aa:bb:cc:dd:ee:ff 34 ABC 123";
    const plain = setup(output);
    await plain.gw.listTools();
    expect(textOf(await plain.gw.callTool("crm__get_customer", {}))).toBe(output);

    const opted = setup(output, { piiMasking: { enabled: true, include: ["ip_address", "plate_tr"] } });
    await opted.gw.listTools();
    const text = textOf(await opted.gw.callTool("crm__get_customer", {}));
    expect(text).not.toContain("10.0.3.17");
    expect(text).not.toContain("34 ABC 123");
    expect(text).toContain("aa:bb:cc:dd:ee:ff");
    expect(opted.events.find((e) => e.type === "tool_response")?.piiHits).toEqual({ ip_address: 1, plate_tr: 1 });
  });

  it("tokenize mode covers the opt-in detectors too", async () => {
    const { gw } = setup("client 10.0.3.17", { piiMasking: { enabled: true, mode: "tokenize", include: ["ip_address"] } });
    await gw.listTools();
    expect(textOf(await gw.callTool("crm__get_customer", {}))).toMatch(/client <pii:ip_address:[0-9a-f]{8}>/);
  });
});
