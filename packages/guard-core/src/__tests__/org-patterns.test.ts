import { describe, it, expect } from "vitest";
import { maskPiiInText, maskPiiInValue } from "../pii.js";
import { OrgPatterns, PiiPatternTimeoutError, orgPatternIssues, type OrgPatternEvent } from "../org-patterns.js";
import { gatewayPolicySchema } from "../policy.js";

/** Catastrophic backtracking on a run of a's with no b. */
const EVIL = "(a+)+b";
const SLOW_TEXT = "a".repeat(40);

describe("block patterns", () => {
  const org = OrgPatterns.compile({ blockPatterns: [{ pattern: "CL-\\d{6}", category: "CLIENT_NO" }, "DOSYA/\\d{4}"] });

  it("mask what no detector knows, numbered per value", () => {
    expect(maskPiiInText("CL-123456 ve CL-654321, yine CL-123456; DOSYA/2024", undefined, undefined, org)).toBe(
      "<CLIENT_NO_1> ve <CLIENT_NO_2>, yine <CLIENT_NO_1>; <CUSTOM_1>",
    );
  });

  it("number values the same way across a whole object", () => {
    expect(maskPiiInValue({ a: "CL-123456", b: ["CL-999999", "CL-123456"] }, undefined, undefined, org)).toEqual({
      a: "<CLIENT_NO_1>",
      b: ["<CLIENT_NO_2>", "<CLIENT_NO_1>"],
    });
  });

  it("lose an overlap to a built-in detection", () => {
    const digits = OrgPatterns.compile({ blockPatterns: [{ pattern: "\\d{11}", category: "LONG_NO" }] });
    expect(maskPiiInText("TC 10000000146, ref 12345678901", undefined, undefined, digits)).toBe("TC [TC-KİMLİK], ref <LONG_NO_1>");
  });

  it("pass the category to a replacer, which can tokenize or keep the default", () => {
    const seen: string[] = [];
    const out = maskPiiInText("CL-123456 ali@example.com", (name, match) => (seen.push(`${name}:${match}`), name === "email" ? "[E]" : undefined), undefined, org);
    expect(out).toBe("<CLIENT_NO_1> [E]");
    expect(seen).toEqual(["email:ali@example.com", "CLIENT_NO:CL-123456"]);
  });
});

describe("allow patterns", () => {
  it("leave a detected value whose whole text matches, and report it", () => {
    const events: OrgPatternEvent[] = [];
    const org = OrgPatterns.compile({ allowPatterns: ["destek@acme\\.com\\.tr"] }, { onEvent: (e) => events.push(e) });
    expect(maskPiiInText("destek@acme.com.tr veya ayse@example.com", undefined, undefined, org)).toBe("destek@acme.com.tr veya ***@[EMAIL]");
    expect(events).toEqual([{ type: "allowed", pattern: "destek@acme\\.com\\.tr", detector: "email" }]);
  });

  it("need the whole detected value, not a part of it", () => {
    const org = OrgPatterns.compile({ allowPatterns: ["acme"] });
    expect(maskPiiInText("destek@acme.com.tr", undefined, undefined, org)).toBe("***@[EMAIL]");
  });

  it("do not exempt block pattern matches", () => {
    const org = OrgPatterns.compile({ blockPatterns: [{ pattern: "CL-\\d{6}", category: "CLIENT_NO" }], allowPatterns: ["CL-\\d{6}"] });
    expect(maskPiiInText("CL-123456", undefined, undefined, org)).toBe("<CLIENT_NO_1>");
  });
});

describe("time budget: asymmetric on purpose", () => {
  it("a block pattern over budget refuses: nothing goes out under-masked", () => {
    const org = OrgPatterns.compile({ blockPatterns: [EVIL] }, { budgetMs: 20 });
    expect(() => maskPiiInText(SLOW_TEXT, undefined, undefined, org)).toThrow(PiiPatternTimeoutError);
  });

  it("an allow pattern over budget is skipped: the value stays masked", () => {
    const events: OrgPatternEvent[] = [];
    const org = OrgPatterns.compile({ allowPatterns: [`${EVIL}|.*@example\\.com`] }, { budgetMs: 20, onEvent: (e) => events.push(e) });
    const started = Date.now();
    expect(maskPiiInText(`${SLOW_TEXT}@example.com`, undefined, undefined, org)).toBe("***@[EMAIL]");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(events).toEqual([{ type: "allow_skipped", pattern: `${EVIL}|.*@example\\.com` }]);
  });
});

describe("validation", () => {
  it("rejects a category that is a built-in detector name or not a label", () => {
    expect(orgPatternIssues({ blockPatterns: [{ pattern: "x", category: "EMAIL" }, { pattern: "y", category: "TC_KIMLIK" }, { pattern: "z", category: "SECRET" }, { pattern: "w", category: "client-no" }] }).map((i) => i.message)).toEqual([
      'category "EMAIL" is a built-in detector name',
      'category "TC_KIMLIK" is a built-in detector name',
      'category "SECRET" is a built-in detector name',
      "a category is upper case letters, digits and _ (e.g. CLIENT_NO), at most 32",
    ]);
  });

  it("rejects an invalid regex, a long pattern and too many patterns", () => {
    const issues = orgPatternIssues({ blockPatterns: ["(unclosed", "a".repeat(201)], allowPatterns: Array.from({ length: 24 }, (_, i) => `p${i}`) });
    expect(issues.map((i) => i.path.join("."))).toEqual(["", "blockPatterns.0", "blockPatterns.1"]);
    expect(issues[0]!.message).toContain("at most 25");
    expect(() => OrgPatterns.compile({ blockPatterns: ["(unclosed"] })).toThrow("invalid regular expression");
  });

  it("the gateway policy validates them in place", () => {
    const bad = gatewayPolicySchema.safeParse({ interceptors: { piiMasking: { enabled: true, blockPatterns: [{ pattern: "x", category: "IBAN" }], allowPatterns: ["("] } } });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path.join("."))).toEqual(["interceptors.piiMasking.blockPatterns.0.category", "interceptors.piiMasking.allowPatterns.0"]);
    expect(gatewayPolicySchema.safeParse({ interceptors: { piiMasking: { enabled: true, blockPatterns: ["CL-\\d{6}"], allowPatterns: ["x"] } } }).success).toBe(true);
  });
});

describe("a request can only add masking", () => {
  const config = OrgPatterns.compile({ blockPatterns: [{ pattern: "CL-\\d{6}", category: "CLIENT_NO" }], allowPatterns: ["destek@acme\\.com\\.tr"] });

  it("adds its block patterns to the configured ones, which stay", () => {
    const merged = config.withRequest({ blockPatterns: [{ pattern: "SIP-\\d{4}", category: "ORDER_NO" }] });
    expect(maskPiiInText("CL-123456 SIP-1234 destek@acme.com.tr", undefined, undefined, merged)).toBe("<CLIENT_NO_1> <ORDER_NO_1> destek@acme.com.tr");
  });

  it("cannot bring allow patterns", () => {
    expect(() => config.withRequest({ allowPatterns: [".*"] })).toThrow("allowPatterns cannot come from a request");
  });

  it("is held to the same limits and reserved names", () => {
    expect(() => config.withRequest({ blockPatterns: [{ pattern: "x", category: "EMAIL" }] })).toThrow("built-in detector name");
    expect(() => config.withRequest({ blockPatterns: Array.from({ length: 24 }, (_, i) => `r${i}`) })).toThrow("at most 25");
  });
});
