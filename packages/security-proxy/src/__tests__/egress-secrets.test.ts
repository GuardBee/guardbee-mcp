import { describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../audit/logger.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import { Gateway } from "../gateway/gateway.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

// Random, not a real token: the rules skip obvious placeholders such as ghp_xxxx…
// Assembled at runtime so the repo's own secret scan does not flag this file.
const TOKEN = ["ghp", "u8jzPde0IgxLd6GncfBAepfJBd0Kh8oOOL8d"].join("_");

const labels: GatewayConfig["labels"] = {
  slack__post_message: ["egress"],
  notes__save: [],
  vault__get_secret: ["sensitive"],
  deploy__set_env: ["egress"],
};

function setup(overrides: Partial<GatewayConfig> = {}) {
  const slack = fakeUpstream("slack", [{ name: "post_message", returns: "sent" }]);
  const notes = fakeUpstream("notes", [{ name: "save", returns: "saved" }]);
  const vault = fakeUpstream("vault", [{ name: "get_secret", returns: `token: ${TOKEN}` }]);
  const deploy = fakeUpstream("deploy", [{ name: "set_env", returns: "ok" }]);
  const logger = new AuditLogger({ enabled: false, sink: "console" });
  const events: AuditEvent[] = [];
  vi.spyOn(logger, "log").mockImplementation((event) => void events.push(event));
  // taint off: these tests are about the credential check, not the toxic-flow one
  const gw = new Gateway([slack, notes, vault, deploy], gatewayConfig({ labels, taint: { mode: "off", basis: "capability" }, ...overrides }), logger);
  const credential = () => events.filter((e) => e.ruleId === "egress:credential");
  return { gw, slack, notes, deploy, events, credential };
}

describe("credentials leaving through egress tools", () => {
  it("blocks a credential in the arguments, nested or not", async () => {
    const { gw, slack, credential } = setup();
    const result = await gw.callTool("slack__post_message", { channel: "#ops", blocks: [{ text: `here you go: ${TOKEN}` }] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("credential in the arguments");
    expect(textOf(result)).toContain("github_pat");
    expect(slack.calls).toEqual([]);
    expect(credential()).toEqual([expect.objectContaining({ type: "blocked", tool: "slack__post_message" })]);
  });

  it("never writes the credential into the audit log", async () => {
    const { gw, events } = setup();
    await gw.callTool("slack__post_message", { text: TOKEN });
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  it("leaves tools that cannot send data out alone", async () => {
    const { gw, notes } = setup();
    expect((await gw.callTool("notes__save", { body: TOKEN })).isError).toBeFalsy();
    expect(notes.calls).toHaveLength(1);
  });

  it("does not treat personal data as a credential", async () => {
    const { gw, slack, credential } = setup();
    await gw.callTool("slack__post_message", { text: "mail ayse@example.com.tr about the invoice" });
    expect(slack.calls).toHaveLength(1);
    expect(credential()).toEqual([]);
  });

  it("allowTools exempts a tool by glob", async () => {
    const { gw, deploy } = setup({ interceptors: { egressSecrets: { enabled: true, action: "block", allowTools: ["deploy__*"] } } });
    expect((await gw.callTool("deploy__set_env", { GITHUB_TOKEN: TOKEN })).isError).toBeFalsy();
    expect(deploy.calls).toHaveLength(1);
  });

  it("warn: forwards the call and logs a redacted warning", async () => {
    const { gw, slack, credential } = setup({ interceptors: { egressSecrets: { enabled: true, action: "warn" } } });
    await gw.callTool("slack__post_message", { text: TOKEN });
    expect(slack.calls).toHaveLength(1);
    expect(credential()).toEqual([expect.objectContaining({ type: "warn" })]);
    expect(JSON.stringify(credential())).not.toContain(TOKEN);
  });

  it("follows promptInjection.action when not set, and can be turned off", async () => {
    const warn = setup({ interceptors: { promptInjection: { enabled: true, action: "warn" } } });
    await warn.gw.callTool("slack__post_message", { text: TOKEN });
    expect(warn.slack.calls).toHaveLength(1);

    const off = setup({ interceptors: { egressSecrets: { enabled: false, action: "block" } } });
    await off.gw.callTool("slack__post_message", { text: TOKEN });
    expect(off.slack.calls).toHaveLength(1);
    expect(off.credential()).toEqual([]);
  });

  it("checks what the server would receive: a token stays a token unless detokenizeForEgress", async () => {
    const tokenize = { piiMasking: { enabled: true, mode: "tokenize" as const } };
    const kept = setup({ interceptors: tokenize });
    const read = textOf(await kept.gw.callTool("vault__get_secret", { name: "gh" }));
    const token = /<pii:[^>]+>/.exec(read)?.[0];
    expect(token).toBeDefined();
    // The model passes the token on; the proxy keeps it a token for an egress tool
    expect((await kept.gw.callTool("slack__post_message", { text: token })).isError).toBeFalsy();
    expect(JSON.stringify(kept.slack.calls)).not.toContain(TOKEN);

    const real = setup({ interceptors: { piiMasking: { ...tokenize.piiMasking, detokenizeForEgress: true } } });
    const again = /<pii:[^>]+>/.exec(textOf(await real.gw.callTool("vault__get_secret", { name: "gh" })))?.[0];
    const result = await real.gw.callTool("slack__post_message", { text: again });
    expect(result.isError).toBe(true);
    expect(real.slack.calls).toEqual([]);
  });
});

describe("egressSecrets config", () => {
  it("parses from guardbee-proxy.yaml", () => {
    const config = parseGatewayYaml(
      "version: 1\nupstreams:\n  deploy:\n    command: node\ninterceptors:\n  egressSecrets:\n    enabled: true\n    action: block\n    allowTools: [\"deploy__*\"]\n",
    );
    expect(config.interceptors.egressSecrets).toEqual({ enabled: true, action: "block", allowTools: ["deploy__*"] });
  });
});
