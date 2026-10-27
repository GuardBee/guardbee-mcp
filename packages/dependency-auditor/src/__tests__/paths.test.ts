import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseNpmManifest } from "../parsers/npm.js";
import { parsePipRequirements } from "../parsers/pip.js";
import { parsePnpmLock, toDeps } from "../parsers/npm-locks.js";
import { auditDependencies } from "../audit.js";
import { clearOsvCache } from "../osv.js";
import { fixPlan, formatReport, formatPath } from "../report.js";
import type { Dependency } from "../parsers/npm.js";
import type { GraphNode } from "../parsers/graph.js";
import { fixture } from "./fixtures.js";


function paths(deps: Dependency[]): Record<string, string | undefined> {
  return Object.fromEntries(deps.map((d) => [`${d.name}@${d.version}`, d.path?.join(" > ")]));
}

describe("dependency paths from real lockfiles", () => {
  it.each(["npm", "pnpm", "yarn1", "yarn4", "bun"])("%s: transitive ms comes via debug", (dir) => {
    expect(paths(parseNpmManifest(fixture(dir)))).toEqual({
      "debug@2.6.8": "debug@2.6.8",
      "lodash@4.17.15": "lodash@4.17.15",
      "minimist@1.2.0": "minimist@1.2.0",
      "ms@2.0.0": "debug@2.6.8 > ms@2.0.0",
    });
  });

  it("uv: urllib3 comes via requests", () => {
    const p = paths(parsePipRequirements(fixture("uv")));
    expect(p["urllib3@1.23"]).toBe("requests@2.19.0 > urllib3@1.23");
    expect(p["requests@2.19.0"]).toBe("requests@2.19.0");
    expect(p["py@1.4.34"]).toBe("py@1.4.34");
  });

  it.each(["poetry", "pipenv"])("%s: no graph, so no path", (dir) => {
    expect(parsePipRequirements(fixture(dir)).every((d) => d.path === undefined)).toBe(true);
  });
});

describe("package-lock.json v3 resolution", () => {
  function dirWithLock(packages: Record<string, unknown>): string {
    const dir = join(tmpdir(), `pl-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "root" }));
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
    return dir;
  }

  it("resolves nested copies before hoisted ones and merges duplicate releases", () => {
    const deps = parseNpmManifest(
      dirWithLock({
        "": { dependencies: { a: "^1", b: "^1" } },
        "node_modules/a": { version: "1.0.0", dependencies: { c: "^1" } },
        "node_modules/a/node_modules/c": { version: "1.0.0" },
        "node_modules/b": { version: "1.0.0", dependencies: { c: "^2", d: "^1" } },
        "node_modules/c": { version: "2.0.0" },
        "node_modules/d": { version: "1.0.0", dependencies: { c: "^2" } },
        "node_modules/b/node_modules/e": { version: "1.0.0" },
        "node_modules/x/node_modules/e": { version: "1.0.0" },
      })
    );
    const p = paths(deps);
    expect(p["c@1.0.0"]).toBe("a@1.0.0 > c@1.0.0");
    expect(p["c@2.0.0"]).toBe("b@1.0.0 > c@2.0.0");
    expect(deps.filter((d) => d.name === "e")).toHaveLength(1);
  });

  it("walks up to an ancestor's node_modules before the hoisted copy", () => {
    const deps = parseNpmManifest(
      dirWithLock({
        "": { dependencies: { a: "^1" } },
        "node_modules/a": { version: "1.0.0", dependencies: { b: "^1" } },
        "node_modules/a/node_modules/b": { version: "1.0.0", dependencies: { c: "^1" } },
        "node_modules/a/node_modules/c": { version: "1.0.0" },
        "node_modules/c": { version: "9.0.0" },
      })
    );
    const p = paths(deps);
    expect(p["c@1.0.0"]).toBe("a@1.0.0 > b@1.0.0 > c@1.0.0");
    expect(p["c@9.0.0"]).toBeUndefined();
  });

  it("uses workspace members' dependencies as roots and never audits the members", () => {
    const deps = parseNpmManifest(
      dirWithLock({
        "": { name: "root", workspaces: ["packages/*"], devDependencies: { tool: "^1" } },
        "packages/app": { name: "app", version: "1.0.0", dependencies: { lib: "^1" } },
        "node_modules/app": { resolved: "packages/app", link: true },
        "node_modules/lib": { version: "1.0.0", dependencies: { leaf: "^1" } },
        "node_modules/leaf": { version: "1.0.0" },
        "node_modules/tool": { version: "1.0.0", dev: true },
      })
    );
    expect(paths(deps)).toEqual({
      "lib@1.0.0": "lib@1.0.0",
      "leaf@1.0.0": "lib@1.0.0 > leaf@1.0.0",
      "tool@1.0.0": "tool@1.0.0",
    });
    expect(deps.find((d) => d.name === "tool")!.isDev).toBe(true);
  });
});

describe("pnpm-lock v6 paths", () => {
  it("follows the packages graph from importers", () => {
    const deps = parsePnpmLock(`lockfileVersion: '6.0'
importers:
  .:
    dependencies:
      express:
        specifier: ^4
        version: 4.21.2
packages:
  /express@4.21.2:
    dev: false
    dependencies:
      proxy-addr: 2.0.7
  /proxy-addr@2.0.7:
    dev: false
`);
    expect(paths(deps)["proxy-addr@2.0.7"]).toBe("express@4.21.2 > proxy-addr@2.0.7");
  });

  it("follows aliased dependencies (/real@version)", () => {
    const deps = parsePnpmLock(`lockfileVersion: '6.0'
importers:
  .:
    dependencies:
      cli:
        specifier: ^1
        version: 1.0.0
packages:
  /cli@1.0.0:
    dependencies:
      sw: /string-width@4.2.3
  /string-width@4.2.3:
    dev: false
`);
    expect(paths(deps)["string-width@4.2.3"]).toBe("cli@1.0.0 > string-width@4.2.3");
  });
});

describe("toDeps merging", () => {
  it("a release with one production copy is production and keeps the production path", () => {
    const nodes = new Map<string, GraphNode>([
      ["tool", { name: "tool", version: "1.0.0", deps: ["tool/x"] }],
      ["tool/x", { name: "x", version: "1.0.0", deps: [] }],
      ["app", { name: "app", version: "1.0.0", deps: ["mid"] }],
      ["mid", { name: "mid", version: "1.0.0", deps: ["x"] }],
      ["x", { name: "x", version: "1.0.0", deps: [] }],
    ]);
    const x = toDeps(nodes, ["app"], ["tool"]).find((d) => d.name === "x")!;
    expect(x.isDev).toBe(false);
    expect(x.path).toEqual(["app@1.0.0", "mid@1.0.0", "x@1.0.0"]);
  });
});

describe("auditDependencies", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearOsvCache();
  });

  it("queries each release once and attaches the shortest path", async () => {
    const queried: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/querybatch")) {
        const body = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string }; version: string }> };
        queried.push(...body.queries.map((q) => `${q.package.name}@${q.version}`));
        return new Response(JSON.stringify({ results: body.queries.map(() => ({ vulns: [{ id: "GHSA-1" }] })) }));
      }
      return new Response(JSON.stringify({ id: "GHSA-1", database_specific: { severity: "HIGH" } }));
    });
    const deps: Dependency[] = [
      { name: "nanoid", version: "3.3.16", isDev: false, source: "lockfile", path: ["next@15", "postcss@8", "nanoid@3.3.16"] },
      { name: "nanoid", version: "3.3.16", isDev: false, source: "lockfile", path: ["next@15", "nanoid@3.3.16"] },
    ];
    const results = await auditDependencies(deps, "npm");
    expect(queried).toEqual(["nanoid@3.3.16"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.path).toEqual(["next@15", "nanoid@3.3.16"]);
  });
});

describe("report", () => {
  const vuln = { id: "GHSA-pa", database_specific: { severity: "HIGH" }, affected: [{ package: { name: "proxy-addr", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.0.8" }] }] }] };

  it("shows the chain per finding and the direct dependency in the fix plan", () => {
    const results = [{ name: "proxy-addr", version: "2.0.7", ecosystem: "npm" as const, vulns: [vuln], path: ["express@4.21.2", "proxy-addr@2.0.7"] }];
    expect(formatReport(results, "npm", 0)).toContain("  Path    : express@4.21.2 › proxy-addr@2.0.7");
    expect(fixPlan(results)[1]).toBe("   proxy-addr 2.0.7 → 2.0.8  (fixes 1/1)  ← via express@4.21.2");
  });

  it("labels direct dependencies and omits the line without a graph", () => {
    expect(formatPath(["next@15.5.20"])).toBe("direct dependency");
    const text = formatReport([{ name: "proxy-addr", version: "2.0.7", ecosystem: "npm", vulns: [vuln] }], "npm", 0);
    expect(text).not.toContain("Path    :");
  });
});
