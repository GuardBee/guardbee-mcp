import { describe, it, expect, afterEach, vi } from "vitest";
import { isMalicious, mergeAliases, getSeverity, queryOsvBatch, clearOsvCache } from "../osv.js";
import type { OsvVuln } from "../osv.js";
import { formatReport } from "../report.js";
import { buildSarif } from "../sarif.js";

// Shapes copied from real OSV records (chalk@5.6.1 and debug@4.4.2, September 2025).
const CHALK_MAL: OsvVuln = {
  id: "MAL-2025-46969",
  summary: "Malicious code in chalk (npm)",
  aliases: ["GHSA-2v46-p5h4-248w"],
  affected: [{ package: { name: "chalk", ecosystem: "npm" }, versions: ["5.6.1"] }],
};
const DEBUG_GHSA: OsvVuln = {
  id: "GHSA-4x49-vf9v-38px",
  summary: "debug@4.4.2 contains malware after npm account takeover",
  aliases: ["CVE-2025-59144", "GHSA-8mgj-vmr8-frr6", "MAL-2025-46974"],
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N" }],
  database_specific: { severity: "HIGH", cwe_ids: ["CWE-506"] },
  affected: [
    {
      package: { name: "debug", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "4.4.2" }, { fixed: "4.4.3" }] }],
    },
  ],
};
const DEBUG_MAL: OsvVuln = {
  id: "MAL-2025-46974",
  summary: "Malicious code in debug (npm)",
  aliases: ["CVE-2025-59144", "GHSA-4x49-vf9v-38px", "GHSA-8mgj-vmr8-frr6"],
};
const CVE_ONLY: OsvVuln = {
  id: "GHSA-aaaa-bbbb-cccc",
  summary: "ReDoS",
  aliases: ["CVE-2020-1111"],
  database_specific: { severity: "MODERATE" },
};

describe("isMalicious", () => {
  it("flags OpenSSF MAL-* records by id or alias", () => {
    expect(isMalicious(CHALK_MAL)).toBe(true);
    expect(isMalicious({ id: "GHSA-x", aliases: ["MAL-2025-1"] })).toBe(true);
  });

  it("flags advisories classified CWE-506 even without a MAL alias", () => {
    expect(isMalicious({ id: "GHSA-mh6f-8j2x-4483", database_specific: { cwe_ids: ["CWE-506"] } })).toBe(true);
  });

  it("does not flag ordinary vulnerabilities, even with 'malicious' in the summary", () => {
    expect(isMalicious(CVE_ONLY)).toBe(false);
    expect(isMalicious({ id: "GHSA-y", summary: "credentials leak via malicious URLs" })).toBe(false);
  });
});

describe("getSeverity on malware", () => {
  it("rates an unscored MAL-* record as critical", () => {
    expect(getSeverity(CHALK_MAL)).toBe("critical");
  });

  it("rates malware critical even when the advisory says HIGH", () => {
    expect(getSeverity(DEBUG_GHSA)).toBe("critical");
  });
});

describe("mergeAliases", () => {
  it("merges records that alias each other and keeps the scored GHSA as representative", () => {
    const merged = mergeAliases([DEBUG_MAL, DEBUG_GHSA]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("GHSA-4x49-vf9v-38px");
    expect(merged[0]!.aliases).toContain("MAL-2025-46974");
    expect(isMalicious(merged[0]!)).toBe(true);
  });

  it("merges GHSA + PYSEC duplicates into one finding", () => {
    const merged = mergeAliases([
      { id: "PYSEC-2018-28", aliases: ["CVE-2018-18074", "GHSA-x84v-xcm2-53pg"] },
      { id: "GHSA-x84v-xcm2-53pg", aliases: ["CVE-2018-18074", "PYSEC-2018-28"], database_specific: { severity: "HIGH" } },
    ]);
    expect(merged.map((v) => v.id)).toEqual(["GHSA-x84v-xcm2-53pg"]);
    expect(merged[0]!.aliases).toEqual(["CVE-2018-18074", "PYSEC-2018-28"]);
  });

  it("merges transitively through a shared CVE and keeps unrelated records apart", () => {
    const merged = mergeAliases([
      { id: "A", aliases: ["CVE-1"] },
      { id: "B", aliases: ["CVE-1", "C"] },
      { id: "C" },
      CVE_ONLY,
    ]);
    expect(merged).toHaveLength(2);
  });

  it("falls back to another record's summary and affected ranges", () => {
    const [m] = mergeAliases([
      { id: "GHSA-1", aliases: ["PYSEC-1"], database_specific: { severity: "LOW" } },
      { id: "PYSEC-1", summary: "from pysec", affected: [{ package: { name: "x", ecosystem: "PyPI" } }] },
    ]);
    expect(m!.summary).toBe("from pysec");
    expect(m!.affected).toHaveLength(1);
  });
});

describe("queryOsvBatch dedupes aliases end to end", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOsvCache();
  });

  it("returns one finding for debug@4.4.2 although OSV lists GHSA and MAL", async () => {
    const records: Record<string, OsvVuln> = { [DEBUG_GHSA.id]: DEBUG_GHSA, [DEBUG_MAL.id]: DEBUG_MAL };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/querybatch")) {
        return new Response(
          JSON.stringify({ results: [{ vulns: [{ id: DEBUG_GHSA.id }, { id: DEBUG_MAL.id }] }] }),
          { status: 200 }
        );
      }
      const id = decodeURIComponent(url.split("/vulns/")[1]!);
      return new Response(JSON.stringify(records[id]), { status: 200 });
    });
    const [res] = await queryOsvBatch([{ name: "debug", version: "4.4.2", ecosystem: "npm" }]);
    expect(res!.vulns).toHaveLength(1);
    expect(isMalicious(res!.vulns[0]!)).toBe(true);
  });
});

describe("report", () => {
  const results = [
    { name: "lodash", version: "4.17.15", ecosystem: "npm" as const, vulns: [CVE_ONLY] },
    { name: "chalk", version: "5.6.1", ecosystem: "npm" as const, vulns: [CHALK_MAL] },
  ];

  it("puts malware first with a removal action and counts it", () => {
    const text = formatReport(results, "npm", 0);
    expect(text.split("\n")[0]).toMatch(/^🚨 1 known-malicious package version installed/);
    expect(text).toMatch(/Critical: 1 .*\(Malicious: 1\)/);
    const malAt = text.indexOf("[MALICIOUS] chalk@5.6.1");
    const medAt = text.indexOf("[MEDIUM] lodash@4.17.15");
    expect(malAt).toBeGreaterThan(-1);
    expect(medAt).toBeGreaterThan(malAt);
    expect(text).toContain("rotate the credentials");
    expect(text).toContain("https://osv.dev/vulnerability/MAL-2025-46969");
  });

  it("omits the malware banner when there is none", () => {
    const text = formatReport([results[0]!], "npm", 0);
    expect(text).not.toContain("🚨");
    expect(text).not.toContain("Malicious:");
  });

  it("tags malware in SARIF as an error with a 'malicious' tag", () => {
    const sarif = buildSarif("0.0.0", results) as {
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string; properties: { tags: string[] } }> } };
        results: Array<{ ruleId: string; level: string; message: { text: string } }>;
      }>;
    };
    const run = sarif.runs[0]!;
    const rule = run.tool.driver.rules.find((r) => r.id === "MAL-2025-46969")!;
    expect(rule.properties.tags).toContain("malicious");
    const res = run.results.find((r) => r.ruleId === "MAL-2025-46969")!;
    expect(res.level).toBe("error");
    expect(res.message.text).toMatch(/known-malicious release/);
  });
});
