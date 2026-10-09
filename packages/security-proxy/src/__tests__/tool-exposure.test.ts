import { describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../audit/logger.js";
import { parseGatewayYaml, type GatewayConfig } from "../gateway/config.js";
import { Gateway } from "../gateway/gateway.js";
import type { AuditEvent } from "../types.js";
import { fakeUpstream, gatewayConfig, textOf } from "./fakes.js";

function setup(overrides: Partial<GatewayConfig> = {}) {
  const github = fakeUpstream("github", [
    { name: "get_issue", description: "Get an issue" },
    { name: "create_issue", description: "Create an issue" },
    { name: "delete_repo", description: "Delete a repository" },
  ]);
  const db = fakeUpstream("postgres", [{ name: "query", description: "Run SQL" }]);
  const logger = new AuditLogger({ enabled: false, sink: "console" });
  const events: AuditEvent[] = [];
  vi.spyOn(logger, "log").mockImplementation((event) => void events.push(event));
  const config = gatewayConfig(overrides);
  const gw = new Gateway([github, db], config, logger);
  const names = async () => (await gw.listTools()).map((tool) => tool.name);
  return { gw, github, db, events, config, names };
}

const tools = (partial: Partial<GatewayConfig["tools"]>): GatewayConfig["tools"] => ({ hide: [], descriptions: {}, ...partial });

describe("tool exposure", () => {
  it("lists every tool by default", async () => {
    const { names } = setup();
    expect(await names()).toEqual(["github__get_issue", "github__create_issue", "github__delete_repo", "postgres__query"]);
  });

  it("expose is an allowlist of globs", async () => {
    const { names } = setup({ tools: tools({ expose: ["github__get_*", "postgres__*"] }) });
    expect(await names()).toEqual(["github__get_issue", "postgres__query"]);
  });

  it("hide removes tools, also after expose", async () => {
    const { names } = setup({ tools: tools({ expose: ["github__*"], hide: ["*__delete_*"] }) });
    expect(await names()).toEqual(["github__get_issue", "github__create_issue"]);
  });

  it("refuses a call to a hidden tool, listed or not, and logs it", async () => {
    const { gw, github, events } = setup({ tools: tools({ hide: ["github__delete_repo"] }) });
    // Called without listing first: the agent guessed the name
    const result = await gw.callTool("github__delete_repo", { repo: "acme/api" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not exposed by this gateway");
    expect(github.calls).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "blocked", tool: "github__delete_repo" }));
  });

  it("calling hidden tools counts toward repeated blocks", async () => {
    const { gw, events } = setup({
      tools: tools({ hide: ["github__delete_repo"] }),
      interceptors: { anomaly: { enabled: true, action: "warn", repeatedBlocks: { count: 1, windowSeconds: 300 } } },
    });
    await gw.callTool("github__delete_repo", {});
    await gw.callTool("github__delete_repo", {});
    expect(events).toContainEqual(expect.objectContaining({ ruleId: "anomaly:repeated_blocks" }));
  });

  it("replaces descriptions with the ones you wrote", async () => {
    const { gw } = setup({ tools: tools({ descriptions: { github__create_issue: "Create an issue in acme/* repos only." } }) });
    const listed = await gw.listTools();
    expect(listed.find((t) => t.name === "github__create_issue")?.description).toBe("Create an issue in acme/* repos only.");
    expect(listed.find((t) => t.name === "github__get_issue")?.description).toBe("Get an issue");
  });

  it("a changed description is not mistaken for a rug pull", async () => {
    const { gw, github } = setup({ tools: tools({ descriptions: { github__get_issue: "Read one issue." } }) });
    await gw.listTools();
    const result = await gw.callTool("github__get_issue", { number: 1 });
    expect(result.isError).toBeFalsy();
    expect(github.calls).toHaveLength(1);
  });

  it("applies a policy update to the next list and call", async () => {
    const { gw, config, names } = setup();
    expect(await names()).toContain("postgres__query");
    config.tools = tools({ hide: ["postgres__*"] });
    expect(await names()).not.toContain("postgres__query");
    expect((await gw.callTool("postgres__query", { sql: "select 1" })).isError).toBe(true);
  });
});

describe("anomaly config follows policy updates", () => {
  it("starts checking when interceptors.anomaly is turned on mid-session", async () => {
    const { gw, config, events } = setup();
    for (let i = 0; i < 3; i++) await gw.callTool("postgres__query", { sql: `${i}` });
    config.interceptors = { anomaly: { enabled: true, action: "warn", callBurst: { count: 2, windowSeconds: 60 } } };
    for (let i = 0; i < 3; i++) await gw.callTool("postgres__query", { sql: `later ${i}` });
    expect(events).toContainEqual(expect.objectContaining({ ruleId: "anomaly:call_burst" }));
  });
});

describe("tools config", () => {
  const base = "version: 1\nupstreams:\n  github:\n    command: node\n";

  it("parses from guardbee-proxy.yaml with defaults", () => {
    expect(parseGatewayYaml(base).tools).toEqual({ hide: [], descriptions: {} });
    const config = parseGatewayYaml(`${base}tools:\n  expose: ["github__get_*"]\n  hide: ["*__delete_*"]\n  descriptions:\n    github__get_issue: Read one issue.\n`);
    expect(config.tools).toEqual({ expose: ["github__get_*"], hide: ["*__delete_*"], descriptions: { github__get_issue: "Read one issue." } });
  });

  it("rejects unknown keys", () => {
    expect(() => parseGatewayYaml(`${base}tools:\n  allow: ["x"]\n`)).toThrow(/allow/);
  });
});
