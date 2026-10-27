import { describe, expect, it } from "vitest";
import type { AuditLogger } from "../audit/logger.js";
import { Gateway } from "../gateway/gateway.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import type { Approver } from "../gateway/approval.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

const topics: GatewayConfig["topics"] = [
  { id: "ma", terms: ["birleşme", "satın alma", "acquisition"], minMatches: 1 },
  { id: "salary", terms: ["maaş", "bordro", "payroll"], minMatches: 1 },
];

function setup(rules: GatewayConfig["rules"], returns = "ok", approver?: Approver) {
  const events: AuditEvent[] = [];
  const audit = { log: (event: AuditEvent) => events.push(event), close: async () => {} } as unknown as AuditLogger;
  const mail = fakeUpstream("mail", [
    { name: "send_email", description: "Send an email", returns },
    { name: "read_inbox", description: "Read the inbox", returns },
  ]);
  const gw = new Gateway([mail], gatewayConfig({ topics, rules, taint: { mode: "off", basis: "capability" } }), audit, approver);
  return { gw, mail, events };
}

describe("topic rules — tool arguments", () => {
  it("denies a call whose arguments are about the topic, in Turkish or English", async () => {
    const { gw, mail, events } = setup([{ id: "no-ma", match: { topic: "ma", tool: "mail__send_email" }, action: "deny" }]);
    await gw.listTools();
    const tr = await gw.callTool("mail__send_email", { to: "x@y.com", body: "ACME ile BİRLEŞME görüşmesi yarın" });
    expect(tr.isError).toBe(true);
    expect(textOf(tr)).toContain("no-ma");
    const en = await gw.callTool("mail__send_email", { body: "Draft the acquisition memo" });
    expect(en.isError).toBe(true);
    expect(mail.calls).toHaveLength(0);
    expect(events.filter((e) => e.type === "blocked" && e.ruleId === "no-ma")).toHaveLength(2);

    const ok = await gw.callTool("mail__send_email", { body: "lunch at noon?" });
    expect(ok.isError).toBeFalsy();
  });

  it("a topic rule does not match a call that is off topic, so later rules still apply", async () => {
    const { gw } = setup([
      { id: "no-salary", match: { topic: "salary" }, action: "deny" },
      { id: "warn-all", match: { tool: "*" }, action: "warn" },
    ]);
    await gw.listTools();
    expect((await gw.callTool("mail__send_email", { body: "maaşlar ekte" })).isError).toBe(true);
    expect((await gw.callTool("mail__send_email", { body: "hello" })).isError).toBeFalsy();
  });
});

describe("topic rules — results, resources and prompts", () => {
  it("withholds a result that turns out to be about the topic", async () => {
    const { gw, events } = setup([{ id: "salary-out", match: { topic: "salary" }, action: "deny" }], "Ekim bordrosu: Ali 85.000 TL");
    await gw.listTools();
    const result = await gw.callTool("mail__read_inbox", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Tool result withheld");
    expect(textOf(result)).not.toContain("85.000");
    expect(events.some((e) => e.type === "blocked" && e.ruleId === "salary-out" && e.tool === "mail__read_inbox")).toBe(true);
  });

  it("warn logs, mask forces PII masking even with masking off", async () => {
    const warn = setup([{ id: "w", match: { topic: "ma" }, action: "warn" }], "acquisition list");
    await warn.gw.listTools();
    expect(textOf(await warn.gw.callTool("mail__read_inbox", {}))).toBe("acquisition list");
    expect(warn.events.some((e) => e.type === "warn" && e.ruleId === "w")).toBe(true);

    const events: AuditEvent[] = [];
    const audit = { log: (e: AuditEvent) => events.push(e), close: async () => {} } as unknown as AuditLogger;
    const mail = fakeUpstream("mail", [{ name: "read_inbox", returns: "bordro: ali@acme.com" }]);
    const gw = new Gateway(
      [mail],
      gatewayConfig({ topics, rules: [{ id: "m", match: { topic: "salary" }, action: "mask" }], interceptors: { piiMasking: { enabled: false } } }),
      audit,
    );
    await gw.listTools();
    expect(textOf(await gw.callTool("mail__read_inbox", {}))).not.toContain("ali@acme.com");
  });

  it("approve asks once: not again for the result when the arguments already matched the same rule", async () => {
    const asked: string[] = [];
    const approver: Approver = async (request) => (asked.push(request.reason), "approved");
    const { gw } = setup([{ id: "ask", match: { topic: "ma" }, action: "approve" }], "acquisition update sent", approver);
    await gw.listTools();
    expect((await gw.callTool("mail__send_email", { body: "acquisition update" })).isError).toBeFalsy();
    expect(asked).toHaveLength(1);
    // Off-topic arguments, on-topic answer: asked for the answer
    expect((await gw.callTool("mail__read_inbox", {})).isError).toBeFalsy();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain("the answer");
  });

  it("withholds a resource and a prompt about the topic", async () => {
    const events: AuditEvent[] = [];
    const audit = { log: (e: AuditEvent) => events.push(e), close: async () => {} } as unknown as AuditLogger;
    const docs = fakeUpstream("docs", [], [{ uri: "file:///hr/payroll.txt", name: "payroll", text: "Bordro Ekim" }]);
    docs.getPrompt = async () => ({ messages: [{ role: "user", content: { type: "text", text: "Summarise the acquisition plan" } }] });
    docs.listPrompts = async () => [{ name: "plan" }];
    const gw = new Gateway([docs], gatewayConfig({ topics, rules: [{ id: "d", match: { topic: "salary" }, action: "deny" }, { id: "p", match: { topic: "ma" }, action: "deny" }] }), audit);
    await gw.listResources();
    await expect(gw.readResource("file:///hr/payroll.txt")).rejects.toThrow(/Resource withheld/);
    await expect(gw.getPrompt("docs__plan")).rejects.toThrow(/Prompt withheld/);
  });
});

describe("topic rules — config", () => {
  it("parses topics from YAML and refuses a rule naming an unknown topic", () => {
    const yaml = `
version: 1
upstreams: { mail: { command: mail-mcp } }
topics:
  - { id: ma, terms: [birleşme, "satın alma"] }
rules:
  - { match: { topic: ma }, action: deny }
`;
    expect(parseGatewayYaml(yaml).topics).toEqual([{ id: "ma", terms: ["birleşme", "satın alma"], minMatches: 1 }]);
    expect(() => parseGatewayYaml(yaml.replace("topic: ma }", "topic: hr }"))).toThrow(/no topic with id "hr"/);
  });
});
