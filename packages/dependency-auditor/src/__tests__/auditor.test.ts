import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseNpmManifest } from "../parsers/npm.js";
import { parsePipRequirements } from "../parsers/pip.js";
import { getSeverity, getFixedVersion } from "../osv.js";
import type { OsvVuln } from "../osv.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `auditor-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── npm parser ────────────────────────────────────────────────────────────────

describe("parseNpmManifest", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  it("returns empty array when no package.json", () => {
    expect(parseNpmManifest(dir)).toEqual([]);
  });

  it("parses package.json dependencies", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { express: "^4.18.2" },
        devDependencies: { vitest: "^2.0.0" },
      })
    );
    const deps = parseNpmManifest(dir);
    const express = deps.find((d) => d.name === "express");
    expect(express).toBeDefined();
    expect(express!.version).toBe("4.18.2"); // range stripped
    expect(express!.isDev).toBe(false);
  });

  it("marks devDependencies as isDev=true", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { vitest: "2.0.0" } })
    );
    const deps = parseNpmManifest(dir);
    expect(deps[0]!.isDev).toBe(true);
  });

  it("prefers package-lock.json v2 locked versions", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { lodash: "^4.0.0" } })
    );
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 2,
        packages: {
          "": {},
          "node_modules/lodash": { version: "4.17.21", dev: false },
        },
      })
    );
    const deps = parseNpmManifest(dir);
    const lodash = deps.find((d) => d.name === "lodash");
    expect(lodash!.version).toBe("4.17.21");
    expect(lodash!.source).toBe("lockfile");
  });

  it("handles package-lock.json v1 dependencies field", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { moment: "*" } })
    );
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          moment: {
            version: "2.29.4",
            dependencies: { "nested-dep": { version: "1.2.3" } },
          },
        },
      })
    );
    const deps = parseNpmManifest(dir);
    expect(deps.find((d) => d.name === "moment")?.version).toBe("2.29.4");
    expect(deps.find((d) => d.name === "nested-dep")?.version).toBe("1.2.3");
  });

  it("uses the real package name for nested and scoped lockfile paths", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { foo: "1.0.0" } }));
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/foo": { version: "1.0.0" },
          "node_modules/foo/node_modules/bar": { version: "2.0.0" },
          "node_modules/@scope/pkg": { version: "3.1.0" },
          "node_modules/foo/node_modules/@scope/nested": { version: "4.0.0" },
          "node_modules/alias": { name: "real-pkg", version: "5.0.0" },
        },
      })
    );
    const deps = parseNpmManifest(dir);
    expect(deps.map((d) => `${d.name}@${d.version}`).sort()).toEqual([
      "@scope/nested@4.0.0",
      "@scope/pkg@3.1.0",
      "bar@2.0.0",
      "foo@1.0.0",
      "real-pkg@5.0.0",
    ]);
  });

  it("strips semver range operators from package.json versions", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { axios: "~1.6.0" } })
    );
    const deps = parseNpmManifest(dir);
    expect(deps[0]!.version).toBe("1.6.0");
  });
});

// ── pip parser ────────────────────────────────────────────────────────────────

describe("parsePipRequirements", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  it("returns empty array when no requirements file", () => {
    expect(parsePipRequirements(dir)).toEqual([]);
  });

  it("parses pinned packages from requirements.txt", () => {
    writeFileSync(join(dir, "requirements.txt"), "requests==2.31.0\nflask==3.0.0\n");
    const deps = parsePipRequirements(dir);
    expect(deps.find((d) => d.name === "requests")?.version).toBe("2.31.0");
    expect(deps.find((d) => d.name === "flask")?.version).toBe("3.0.0");
  });

  it("ignores comments and flags in requirements.txt", () => {
    writeFileSync(join(dir, "requirements.txt"), "# comment\n--index-url https://pypi.org\nrequests==2.31.0\n");
    const deps = parsePipRequirements(dir);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe("requests");
  });

  it("uses the lower bound of a version range instead of concatenating it", () => {
    writeFileSync(join(dir, "requirements.txt"), "django>=4.2,<5\n");
    const deps = parsePipRequirements(dir);
    expect(deps[0]!.name).toBe("django");
    expect(deps[0]!.version).toBe("4.2");
  });

  it("keeps the package name when an extra is specified", () => {
    writeFileSync(join(dir, "requirements.txt"), "requests[security]==2.31.0\n");
    const deps = parsePipRequirements(dir);
    expect(deps[0]).toMatchObject({ name: "requests", version: "2.31.0" });
  });

  it("parses PEP 621 pyproject.toml dependencies", () => {
    writeFileSync(
      join(dir, "pyproject.toml"),
      `[project]
name = "demo"
dependencies = [
  "httpx[http2]==0.27.0",
  "requests>=2.28.0",
]
`
    );
    const deps = parsePipRequirements(dir);
    expect(deps.find((d) => d.name === "httpx")?.version).toBe("0.27.0");
    expect(deps.find((d) => d.name === "requests")?.version).toBe("2.28.0");
  });
});

// ── OSV helpers ───────────────────────────────────────────────────────────────

describe("getSeverity", () => {
  it("returns critical for CVSS >= 9.0", () => {
    const vuln: OsvVuln = { id: "OSV-1", severity: [{ type: "CVSS_V3", score: "9.8" }] };
    expect(getSeverity(vuln)).toBe("critical");
  });

  it("returns high for CVSS 7.0–8.9", () => {
    const vuln: OsvVuln = { id: "OSV-2", severity: [{ type: "CVSS_V3", score: "7.5" }] };
    expect(getSeverity(vuln)).toBe("high");
  });

  it("returns medium for CVSS 4.0–6.9", () => {
    const vuln: OsvVuln = { id: "OSV-3", severity: [{ type: "CVSS_V3", score: "5.3" }] };
    expect(getSeverity(vuln)).toBe("medium");
  });

  it("returns low for CVSS < 4.0", () => {
    const vuln: OsvVuln = { id: "OSV-4", severity: [{ type: "CVSS_V3", score: "2.0" }] };
    expect(getSeverity(vuln)).toBe("low");
  });

  it("falls back to text heuristics when no CVSS", () => {
    const vuln: OsvVuln = { id: "OSV-5", summary: "Remote code execution via crafted input" };
    expect(getSeverity(vuln)).toBe("critical");
  });

  it("returns unknown when no score and no matching text", () => {
    const vuln: OsvVuln = { id: "OSV-6", summary: "Cosmetic issue in UI rendering" };
    expect(getSeverity(vuln)).toBe("unknown");
  });

  it("scores a CVSS v3 vector the way OSV returns it", () => {
    const vuln: OsvVuln = {
      id: "OSV-10",
      severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
    };
    expect(getSeverity(vuln)).toBe("critical");
  });

  it("uses database_specific.severity when the vector cannot be scored", () => {
    const vuln: OsvVuln = {
      id: "OSV-11",
      severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N" }],
      database_specific: { severity: "HIGH" },
      summary: "Cosmetic issue in UI rendering",
    };
    expect(getSeverity(vuln)).toBe("high");
  });
});

describe("getFixedVersion", () => {
  it("returns the fixed version for the given package", () => {
    const vuln: OsvVuln = {
      id: "OSV-7",
      affected: [
        {
          package: { name: "lodash", ecosystem: "npm" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
        },
      ],
    };
    expect(getFixedVersion(vuln, "lodash")).toBe("4.17.21");
  });

  it("returns null when package not in affected list", () => {
    const vuln: OsvVuln = {
      id: "OSV-8",
      affected: [
        {
          package: { name: "other-pkg", ecosystem: "npm" },
          ranges: [{ type: "SEMVER", events: [{ fixed: "1.0.0" }] }],
        },
      ],
    };
    expect(getFixedVersion(vuln, "lodash")).toBeNull();
  });

  it("returns null when no ranges", () => {
    const vuln: OsvVuln = {
      id: "OSV-9",
      affected: [{ package: { name: "lodash", ecosystem: "npm" } }],
    };
    expect(getFixedVersion(vuln, "lodash")).toBeNull();
  });
});
