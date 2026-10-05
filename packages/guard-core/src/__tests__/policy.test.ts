import { describe, expect, it } from "vitest";
import { validatePolicy } from "../policy.js";

describe("validatePolicy", () => {
  it("fills defaults for an empty document", () => {
    const result = validatePolicy({});
    expect(result).toEqual({
      ok: true,
      policy: {
        labels: {},
        rules: [],
        taint: { mode: "strict", basis: "capability" },
        approval: { timeoutSeconds: 120, channels: ["elicitation"] },
        defaults: { action: "allow" },
        interceptors: {},
      },
    });
    expect(validatePolicy(null).ok).toBe(true);
  });

  it("reports every problem with its path", () => {
    const result = validatePolicy({
      rules: [{ match: { tool: "x" }, action: "explode" }, { match: {}, action: "deny", mask: { fields: ["a"] } }],
      labels: { a: ["secret"] },
      upstreams: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.startsWith("rules.0.action"))).toBe(true);
      expect(result.issues.some((i) => i.includes("mask.fields only applies to action: mask"))).toBe(true);
      expect(result.issues.some((i) => i.startsWith("labels.a.0"))).toBe(true);
      // Deployment settings do not belong in a policy document.
      expect(result.issues.some((i) => i.includes("upstreams"))).toBe(true);
    }
  });
});

describe("taint.basis", () => {
  it("accepts data and rejects anything else", () => {
    expect(validatePolicy({ taint: { mode: "approve", basis: "data" } })).toMatchObject({ ok: true, policy: { taint: { mode: "approve", basis: "data" } } });
    expect(validatePolicy({ taint: { basis: "content" } }).ok).toBe(false);
  });
});
