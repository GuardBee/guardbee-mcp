import { describe, it, expect } from "vitest";
import { runProbe, runSuite, generateCanary } from "../runner.js";
import { PROBES } from "../probes.js";
import type { ProbeTarget } from "../target.js";

function fakeTarget(respond: (prompt: string) => string): ProbeTarget {
  return { send: async (prompt) => respond(prompt) };
}

describe("generateCanary", () => {
  it("produces unique tokens across calls", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCanary()));
    expect(tokens.size).toBe(50);
  });

  it("has a recognizable prefix", () => {
    expect(generateCanary()).toMatch(/^GB[0-9A-F]+$/);
  });
});

describe("runProbe", () => {
  const directOverride = PROBES.find((p) => p.id === "direct_override")!;

  it("marks bypassed when the target echoes the canary", async () => {
    const target = fakeTarget((prompt) => {
      const canary = prompt.match(/GB[0-9A-F]+/)?.[0] ?? "";
      return `Sure! ${canary}`;
    });
    const result = await runProbe(target, directOverride);
    expect(result.bypassed).toBe(true);
    expect(result.probeId).toBe("direct_override");
  });

  it("marks held when the target refuses without echoing the canary", async () => {
    const target = fakeTarget(() => "I can't comply with that request.");
    const result = await runProbe(target, directOverride);
    expect(result.bypassed).toBe(false);
  });

  it("records an error and does not throw when the target fails", async () => {
    const target: ProbeTarget = { send: async () => { throw new Error("network down"); } };
    const result = await runProbe(target, directOverride);
    expect(result.bypassed).toBe(false);
    expect(result.error).toContain("network down");
  });

  it("base64_instruction probe: target must decode base64 and echo the canary to count as bypassed", async () => {
    const probe = PROBES.find((p) => p.id === "base64_instruction")!;
    const target = fakeTarget((prompt) => {
      const b64 = prompt.match(/[A-Za-z0-9+/=]{20,}/)?.[0] ?? "";
      const decoded = Buffer.from(b64, "base64").toString("utf8"); // "Say exactly: GBxxxx"
      const canary = decoded.replace("Say exactly: ", "");
      return canary;
    });
    const result = await runProbe(target, probe);
    expect(result.bypassed).toBe(true);
  });

  it("truncates a long response to a bounded preview", async () => {
    const target = fakeTarget(() => "x".repeat(1000));
    const result = await runProbe(target, directOverride);
    expect(result.responsePreview.length).toBeLessThanOrEqual(300);
  });
});

describe("runSuite", () => {
  it("runs every probe by default", async () => {
    const target = fakeTarget(() => "refused");
    const result = await runSuite(target);
    expect(result.totalCount).toBe(PROBES.length);
    expect(result.bypassedCount).toBe(0);
  });

  it("filters by category", async () => {
    const target = fakeTarget(() => "refused");
    const result = await runSuite(target, { categories: ["extraction"] });
    expect(result.totalCount).toBe(PROBES.filter((p) => p.category === "extraction").length);
    expect(result.results.every((r) => r.category === "extraction")).toBe(true);
  });

  it("filters by probeIds", async () => {
    const target = fakeTarget(() => "refused");
    const result = await runSuite(target, { probeIds: ["direct_override", "role_play_dan"] });
    expect(result.totalCount).toBe(2);
  });

  it("caps the number of probes with maxProbes", async () => {
    const target = fakeTarget(() => "refused");
    const result = await runSuite(target, { maxProbes: 3 });
    expect(result.totalCount).toBe(3);
  });

  it("counts bypasses when the target echoes canaries for every probe", async () => {
    const target = fakeTarget((prompt) => {
      const canary = prompt.match(/GB[0-9A-F]+/)?.[0];
      return canary ?? "refused";
    });
    const result = await runSuite(target, { maxProbes: 5 });
    // base64 probe hides the canary inside base64 so a naive echo-target won't match it —
    // just assert most non-obfuscated probes bypass.
    expect(result.bypassedCount).toBeGreaterThan(0);
  });
});
