import { describe, it, expect } from "vitest";
import { compareVersions } from "../version.js";
import { getFixedVersion, isAffected, planUpgrade } from "../fix.js";
import { fixPlan } from "../report.js";
import type { AuditResult, OsvVuln } from "../osv.js";

function sorted(list: string[], eco: string): string[] {
  return [...list].sort((a, b) => compareVersions(a, b, eco));
}

describe("compareVersions", () => {
  it("SemVer: pre-releases before the release, numeric identifiers numerically", () => {
    const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.10.0", "v2.0.0"];
    expect(sorted([...order].reverse(), "npm")).toEqual(order);
    expect(compareVersions("5.0.0-beta.31", "5.0.0-beta.32", "npm")).toBeLessThan(0);
    expect(compareVersions("5.0.0-beta.31", "4.24.15", "npm")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0+build.5", "1.0.0", "npm")).toBe(0);
  });

  it("PEP 440: dev < a < b < rc < release < post, with epochs", () => {
    const order = ["1.0.dev1", "1.0a1", "1.0a2", "1.0b1", "1.0rc1", "1.0", "1.0.post1", "1.0.1", "1.1", "2!0.1"];
    expect(sorted([...order].reverse(), "PyPI")).toEqual(order);
    expect(compareVersions("2.19.0", "2.19", "PyPI")).toBe(0);
    expect(compareVersions("1.0-1", "1.0.post1", "PyPI")).toBe(0);
  });

  it("Maven-style generic: qualifiers before the release, numbers after", () => {
    const order = ["2.0-alpha1", "2.0-beta9", "2.0-rc1", "2.0", "2.0.1", "2.3.1", "2.12.2", "2.17.1", "2.25.4", "3.0.0-alpha1", "3.0.0-beta3"];
    expect(sorted([...order].reverse(), "Maven")).toEqual(order);
  });
});

// Real OSV ranges (October 2026).
const NEXT_AUTH: OsvVuln[] = [
  { id: "GHSA-7rqj-j65f-68wh", affected: [{ package: { name: "next-auth", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "4.10.3" }, { fixed: "4.24.15" }] }, { type: "SEMVER", events: [{ introduced: "5.0.0-beta.1" }, { fixed: "5.0.0-beta.32" }] }] }] },
  { id: "GHSA-x445-f3h2-j279", affected: [{ package: { name: "next-auth", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "5.0.0-beta.1" }, { fixed: "5.0.0-beta.32" }] }, { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.24.15" }] }] }] },
];

const LOG4J = "org.apache.logging.log4j:log4j-core";
const log4j = (id: string, ...ranges: Array<Array<Record<string, string>>>): OsvVuln => ({
  id,
  affected: [{ package: { name: LOG4J, ecosystem: "Maven" }, ranges: ranges.map((events) => ({ type: "ECOSYSTEM", events })) }],
});
const LOG4J_VULNS: OsvVuln[] = [
  log4j("GHSA-jfh8-c2jp-5v3q", [{ introduced: "2.13.0" }, { fixed: "2.15.0" }], [{ introduced: "2.0-beta9" }, { fixed: "2.3.1" }], [{ introduced: "2.4" }, { fixed: "2.12.2" }]),
  log4j("GHSA-7rjr-3q55-vv33", [{ introduced: "2.13.0" }, { fixed: "2.16.0" }], [{ introduced: "2.4.0" }, { fixed: "2.12.2" }], [{ introduced: "0" }, { fixed: "2.3.1" }]),
  log4j("GHSA-p6xc-xr62-6r2g", [{ introduced: "2.4.0" }, { fixed: "2.12.3" }], [{ introduced: "2.13.0" }, { fixed: "2.17.0" }], [{ introduced: "0" }, { fixed: "2.3.1" }]),
  log4j("GHSA-8489-44mv-ggj8", [{ introduced: "2.0-beta7" }, { fixed: "2.3.2" }], [{ introduced: "2.4" }, { fixed: "2.12.4" }], [{ introduced: "2.13.0" }, { fixed: "2.17.1" }]),
  log4j("GHSA-vc5p-v9hr-52mj", [{ introduced: "2.0-beta9" }, { fixed: "2.25.3" }]),
  log4j("GHSA-3pxv-7cmr-fjr4", [{ introduced: "2.0-alpha1" }, { fixed: "2.25.4" }], [{ introduced: "3.0.0-alpha1" }, { last_affected: "3.0.0-beta3" }]),
];

describe("getFixedVersion", () => {
  it("picks the fix on the installed branch, not the first listed (next-auth 5 beta)", () => {
    for (const v of NEXT_AUTH) {
      expect(getFixedVersion(v, "next-auth", "5.0.0-beta.31", "npm")).toBe("5.0.0-beta.32");
      expect(getFixedVersion(v, "next-auth", "4.20.0", "npm")).toBe("4.24.15");
    }
  });

  it("follows the 2.13+ branch for log4j 2.14.1", () => {
    const fixes = LOG4J_VULNS.slice(0, 4).map((v) => getFixedVersion(v, LOG4J, "2.14.1", "Maven"));
    expect(fixes).toEqual(["2.15.0", "2.16.0", "2.17.0", "2.17.1"]);
    expect(getFixedVersion(LOG4J_VULNS[1]!, LOG4J, "2.11.0", "Maven")).toBe("2.12.2");
  });

  it("returns null when only last_affected is known", () => {
    const v = log4j("X", [{ introduced: "3.0.0-alpha1" }, { last_affected: "3.0.0-beta3" }]);
    expect(isAffected(v, LOG4J, "3.0.0-beta2", "Maven")).toBe(true);
    expect(isAffected(v, LOG4J, "3.0.0", "Maven")).toBe(false);
    expect(getFixedVersion(v, LOG4J, "3.0.0-beta2", "Maven")).toBeNull();
  });

  it("keeps the pre-0.4 two-argument behaviour", () => {
    expect(getFixedVersion(NEXT_AUTH[0]!, "next-auth")).toBe("4.24.15");
  });
});

describe("isAffected", () => {
  it("honours explicit version lists and normalizes PyPI names", () => {
    const v: OsvVuln = { id: "M", affected: [{ package: { name: "Foo_Bar", ecosystem: "PyPI" }, versions: ["1.0"] }] };
    expect(isAffected(v, "foo-bar", "1.0", "PyPI")).toBe(true);
    expect(isAffected(v, "foo-bar", "1.1", "PyPI")).toBe(false);
  });

  it("ignores GIT ranges", () => {
    const v: OsvVuln = { id: "G", affected: [{ package: { name: "x", ecosystem: "npm" }, ranges: [{ type: "GIT", events: [{ introduced: "0" }, { fixed: "9f1c2e7d" }] }] }] };
    expect(isAffected(v, "x", "1.0.0", "npm")).toBe(false);
    expect(getFixedVersion(v, "x", "1.0.0", "npm")).toBeNull();
  });
});

describe("planUpgrade", () => {
  it("finds the smallest version clearing every advisory (log4j 2.14.1 → 2.25.4)", () => {
    const plan = planUpgrade({ name: LOG4J, version: "2.14.1", ecosystem: "Maven", vulns: LOG4J_VULNS });
    expect(plan).toEqual({ version: "2.25.4", major: false, fixes: 6, total: 6, unfixed: [] });
  });

  it("stays on the 5.x beta line for next-auth", () => {
    const plan = planUpgrade({ name: "next-auth", version: "5.0.0-beta.31", ecosystem: "npm", vulns: NEXT_AUTH });
    expect(plan.version).toBe("5.0.0-beta.32");
  });

  it("reports advisories that no listed version fixes", () => {
    const noFix: OsvVuln = { id: "GHSA-nofix", affected: [{ package: { name: "x", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }] };
    const fixed: OsvVuln = { id: "GHSA-ok", affected: [{ package: { name: "x", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.2.0" }] }] }] };
    expect(planUpgrade({ name: "x", version: "1.0.0", ecosystem: "npm", vulns: [noFix, fixed] })).toEqual({
      version: "1.2.0",
      major: false,
      fixes: 1,
      total: 2,
      unfixed: ["GHSA-nofix"],
    });
    expect(planUpgrade({ name: "x", version: "1.0.0", ecosystem: "npm", vulns: [noFix] }).version).toBeNull();
  });

  it("flags upgrades that cross a major version, including 0.x minors", () => {
    const at = (fixed: string): OsvVuln => ({ id: fixed, affected: [{ package: { name: "x", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }] }] });
    const major = (from: string, to: string) => planUpgrade({ name: "x", version: from, ecosystem: "npm", vulns: [at(to)] }).major;
    expect(major("7.0.13", "10.0.6")).toBe(true);
    expect(major("7.0.13", "7.2.0")).toBe(false);
    expect(major("0.34.5", "0.35.5")).toBe(true);
    expect(major("0.34.5", "0.34.9")).toBe(false);
  });

  it("skips a fixed version that a later range re-affects", () => {
    const v: OsvVuln = {
      id: "R",
      affected: [{ package: { name: "x", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.1.0" }, { introduced: "1.1.0" }, { fixed: "1.3.0" }] }] }],
    };
    expect(getFixedVersion(v, "x", "1.0.0", "npm")).toBe("1.3.0");
  });
});

describe("fixPlan text", () => {
  const results: AuditResult[] = [
    { name: "next-auth", version: "5.0.0-beta.31", ecosystem: "npm", vulns: NEXT_AUTH },
    { name: "chalk", version: "5.6.1", ecosystem: "npm", vulns: [{ id: "MAL-2025-46969" }] },
    { name: "clean", version: "1.0.0", ecosystem: "npm", vulns: [] },
  ];

  it("lists one line per vulnerable package, malware first", () => {
    expect(fixPlan(results)).toEqual([
      "🛠  Fix plan — one upgrade per package:",
      "   chalk 5.6.1 → remove now (known-malicious; no clean version listed)",
      "   next-auth 5.0.0-beta.31 → 5.0.0-beta.32  (fixes 2/2)",
      "",
    ]);
  });

  it("is empty when nothing is vulnerable", () => {
    expect(fixPlan([results[2]!])).toEqual([]);
  });
});
