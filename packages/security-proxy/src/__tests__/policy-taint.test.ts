import { describe, expect, it } from "vitest";
import { evaluatePolicy, globToRegExp, type PolicyRule } from "../gateway/policy.js";
import { TaintTracker } from "../gateway/taint.js";
import { labelTool } from "../gateway/labels.js";

const ctx = { tool: "postgres__query", upstream: "postgres", labels: ["sensitive" as const], tainted: false };

describe("globToRegExp", () => {
  it("matches * and ? and escapes the rest", () => {
    expect(globToRegExp("postgres__delete_*").test("postgres__delete_row")).toBe(true);
    expect(globToRegExp("postgres__delete_*").test("postgres__query")).toBe(false);
    expect(globToRegExp("a?c").test("abc")).toBe(true);
    expect(globToRegExp("a.c").test("abc")).toBe(false);
  });
});

describe("evaluatePolicy", () => {
  it("returns the default when no rule matches", () => {
    expect(evaluatePolicy([], "allow", ctx)).toEqual({ action: "allow" });
  });

  it("first matching rule wins and reports its id or index", () => {
    const rules: PolicyRule[] = [
      { match: { upstream: "github" }, action: "deny" },
      { match: { label: "sensitive" }, action: "mask" },
      { id: "catch-all", match: {}, action: "deny" },
    ];
    expect(evaluatePolicy(rules, "allow", ctx)).toEqual({ action: "mask", ruleId: "rules[1]" });
    expect(evaluatePolicy(rules, "allow", { ...ctx, labels: [] })).toEqual({ action: "deny", ruleId: "catch-all" });
  });

  it("ANDs the fields of one match", () => {
    const rules: PolicyRule[] = [{ match: { upstream: "postgres", session: "tainted" }, action: "deny" }];
    expect(evaluatePolicy(rules, "allow", ctx).action).toBe("allow");
    expect(evaluatePolicy(rules, "allow", { ...ctx, tainted: true }).action).toBe("deny");
  });
});

describe("TaintTracker", () => {
  it("needs both data legs before an egress call completes the trifecta", () => {
    const taint = new TaintTracker();
    expect(taint.completesTrifecta(["egress"])).toBe(false);
    taint.observe("web__fetch", ["untrusted"], false);
    expect(taint.completesTrifecta(["egress"])).toBe(false);
    taint.observe("db__query", [], true);
    expect(taint.completesTrifecta(["egress"])).toBe(true);
    expect(taint.completesTrifecta(["sensitive"])).toBe(false);
  });

  it("keeps the first source of each leg and never clears", () => {
    const taint = new TaintTracker();
    taint.observe("a", ["untrusted", "sensitive"], false);
    taint.observe("b", ["untrusted"], true);
    expect(taint.describe("c")).toContain('"a"');
    expect(taint.describe("c")).not.toContain('"b"');
    expect(taint.snapshot()).toEqual({ sawUntrusted: true, sawSensitive: true });
  });
});

describe("labelTool", () => {
  it("maps guard-core capabilities to gateway labels", () => {
    expect(labelTool({ name: "fetch_url", description: "Fetch a web page" })).toEqual(["untrusted"]);
    expect(labelTool({ name: "send_slack_message", description: "Post to a webhook" })).toEqual(["egress"]);
    expect(labelTool({ name: "drop_table" })).toEqual(["destructive"]);
  });
});
