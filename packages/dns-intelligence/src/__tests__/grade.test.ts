import { describe, it, expect } from "vitest";
import { gradeFindings, formatGrade, formatGradeTable } from "../grade.js";
import { buildSarif, buildSarifMulti } from "../sarif.js";
import { subdomainFindings, formatDnsReport, type DnsEnumerationResult } from "../dns.js";
import type { Finding } from "../dns.js";

const f = (severity: Finding["severity"], code = `X_${severity.toUpperCase()}`): Finding => ({ severity, code, message: code });

describe("gradeFindings", () => {
  it("scores by deductions", () => {
    expect(gradeFindings([])).toMatchObject({ grade: "A", score: 100 });
    expect(gradeFindings([f("low"), f("low")])).toMatchObject({ grade: "A", score: 96 });
    expect(gradeFindings([f("info"), f("info")])).toMatchObject({ grade: "A", score: 100 });
    expect(gradeFindings(Array.from({ length: 6 }, () => f("low")))).toMatchObject({ grade: "B", score: 88 });
  });

  it("caps the grade by the worst finding", () => {
    expect(gradeFindings([f("medium")])).toMatchObject({ grade: "B", score: 92 });
    expect(gradeFindings([f("high")])).toMatchObject({ grade: "C", score: 80 });
    expect(gradeFindings([f("critical")])).toMatchObject({ grade: "F", score: 60 });
    expect(gradeFindings([f("high", "DOMAIN_NOT_FOUND")]).grade).toBe("F");
  });

  it("falls below the cap when deductions add up, and never below zero", () => {
    expect(gradeFindings([f("high"), f("high"), f("medium")])).toMatchObject({ grade: "F", score: 52 });
    expect(gradeFindings(Array.from({ length: 10 }, () => f("critical"))).score).toBe(0);
  });

  it("formats a one-line summary and a table sorted worst first", () => {
    expect(formatGrade(gradeFindings([f("high"), f("low"), f("info")]))).toBe("Grade C (78/100; 1 high, 1 low)");
    const table = formatGradeTable([
      { domain: "good.example", findings: [] },
      { domain: "bad.example", findings: [f("critical")] },
    ]).split("\n");
    expect(table[0]).toMatch(/^Domain\s+Grade\s+Score\s+Crit\s+High\s+Med\s+Low$/);
    expect(table[2]).toMatch(/^bad\.example\s+F\s+60\s+1\s+0\s+0\s+0$/);
    expect(table[3]).toMatch(/^good\.example\s+A\s+100/);
  });

  it("puts the grade at the top of the DNS report", () => {
    const result: DnsEnumerationResult = { domain: "example.com", records: {}, findings: [f("medium")] };
    expect(formatDnsReport(result).split("\n")[1]).toBe("Grade B (92/100; 1 medium)");
  });
});

describe("SARIF", () => {
  it("covers several domains in one run, sharing rules and skipping info findings", () => {
    const sarif = buildSarifMulti("1.0.0", [
      { domain: "a.example", findings: [f("high", "SPF_MISSING"), f("info", "NULL_MX")] },
      { domain: "b.example", findings: [f("high", "SPF_MISSING"), f("low", "CAA_MISSING")] },
    ]) as { runs: Array<{ tool: { driver: { rules: Array<{ id: string; properties: { tags: string[] } }> } }; results: Array<{ ruleId: string; level: string; locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }> }> }> };
    const run = sarif.runs[0]!;
    expect(run.tool.driver.rules.map((r) => r.id)).toEqual(["SPF_MISSING", "CAA_MISSING"]);
    expect(run.tool.driver.rules[0]!.properties.tags).toContain("email-security");
    expect(run.tool.driver.rules[1]!.properties.tags).not.toContain("email-security");
    expect(run.results.map((r) => [r.ruleId, r.level, r.locations[0]!.physicalLocation.artifactLocation.uri])).toEqual([
      ["SPF_MISSING", "error", "dns://a.example"],
      ["SPF_MISSING", "error", "dns://b.example"],
      ["CAA_MISSING", "note", "dns://b.example"],
    ]);
  });

  it("keeps the single-domain signature", () => {
    const one = buildSarif("1.0.0", "a.example", [f("medium", "DKIM_KEY_1024")]) as { runs: Array<{ results: unknown[] }> };
    expect(one.runs[0]!.results).toHaveLength(1);
  });
});

describe("subdomainFindings", () => {
  it("turns takeovers into findings by risk, including the wildcard", () => {
    const takeover = (risk: "vulnerable" | "edge" | "stale") => ({ provider: "P", risk, chain: ["x"], evidence: "e" });
    const out = subdomainFindings({
      results: [
        { subdomain: "a.example.com", resolves: true, dangling: true, danglingReason: "r1", takeover: takeover("vulnerable") },
        { subdomain: "b.example.com", resolves: true, dangling: true, danglingReason: "r2", takeover: takeover("edge") },
        { subdomain: "c.example.com", resolves: true, danglingReason: "r3", takeover: takeover("stale") },
        { subdomain: "d.example.com", resolves: true },
      ],
      wildcard: { addresses: [], hidden: 3, takeover: takeover("vulnerable") },
    });
    expect(out.map((x) => [x.code, x.severity])).toEqual([
      ["WILDCARD_TAKEOVER", "high"],
      ["SUBDOMAIN_TAKEOVER", "high"],
      ["SUBDOMAIN_TAKEOVER", "medium"],
      ["SUBDOMAIN_STALE_CNAME", "low"],
    ]);
    expect(out[1]!.message).toBe("a.example.com: r1");
  });
});
