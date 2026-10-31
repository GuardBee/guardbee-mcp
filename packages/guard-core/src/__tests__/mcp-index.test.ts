import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { gradeBelow, isMcpGrade, loadMcpIndex, lookupMcpGrade, parseLaunch, type McpIndex, type McpIndexEntry } from "../index.js";

const entry = (name: string, packages: McpIndexEntry["packages"], grade: McpIndexEntry["grade"], scannedAt = "2026-11-01T00:00:00Z"): McpIndexEntry => ({
  name,
  version: "1.0.0",
  packages,
  remote: false,
  grade,
  score: grade ? 90 : null,
  reasons: [],
  scannedAt,
  ...(grade ? {} : { note: "not graded" }),
});

const index: McpIndex = {
  format: 1,
  rubricVersion: "2026-11",
  generatedAt: "2026-11-01T00:00:00Z",
  servers: [
    entry("io.github.a/files", [{ ecosystem: "npm", identifier: "@a/files", version: "1.2.0" }], "B"),
    entry("io.github.b/time", [{ ecosystem: "pypi", identifier: "mcp_server_time", version: "0.6.2" }], "A"),
    entry("io.github.c/gh", [{ ecosystem: "oci", identifier: "ghcr.io/c/gh-server:1.0" }], null),
    // Two entries ship the same package: the graded one wins
    entry("io.github.d/old", [{ ecosystem: "npm", identifier: "shared-pkg" }], null, "2026-11-02T00:00:00Z"),
    entry("io.github.d/new", [{ ecosystem: "npm", identifier: "shared-pkg", version: "2.0.0" }], "C"),
  ],
};

describe("lookupMcpGrade", () => {
  it("finds npm, PyPI (normalized) and image entries by what the command launches", () => {
    expect(lookupMcpGrade(index, parseLaunch("npx", ["-y", "@a/files@1.2.0"])!)).toMatchObject({ entry: { name: "io.github.a/files", grade: "B" }, sameVersion: true });
    expect(lookupMcpGrade(index, parseLaunch("npx", ["@a/files"])!)?.sameVersion).toBe(false);
    expect(lookupMcpGrade(index, parseLaunch("uvx", ["mcp-server-time"])!)?.entry.grade).toBe("A");
    expect(lookupMcpGrade(index, parseLaunch("docker", ["run", "-i", "--rm", "ghcr.io/c/gh-server:2.0"])!)?.entry.name).toBe("io.github.c/gh");
    expect(lookupMcpGrade(index, parseLaunch("npx", ["-y", "unknown-pkg"])!)).toBeUndefined();
    expect(lookupMcpGrade(index, parseLaunch("npx", ["shared-pkg"])!)?.entry.name).toBe("io.github.d/new");
  });
});

describe("grades", () => {
  it("orders F < D < C < B < A", () => {
    expect(gradeBelow("C", "B")).toBe(true);
    expect(gradeBelow("B", "B")).toBe(false);
    expect(gradeBelow("A", "F")).toBe(false);
    expect(isMcpGrade("B")).toBe(true);
    expect(isMcpGrade("b")).toBe(false);
    expect(isMcpGrade("E")).toBe(false);
  });
});

describe("loadMcpIndex", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-index-"));
  const cacheFile = path.join(dir, "mcp-index.json");
  afterEach(() => fs.rmSync(cacheFile, { force: true }));
  const requests: string[] = [];
  const serve = (body: unknown, status = 200) => async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify(body), { status });
  };

  it("downloads the whole index once and serves it from the cache for a day", async () => {
    requests.length = 0;
    expect((await loadMcpIndex({ cacheFile, fetch: serve(index) }))?.source).toBe("network");
    expect((await loadMcpIndex({ cacheFile, fetch: serve(index) }))?.source).toBe("cache");
    expect(requests).toEqual(["https://guardbee.github.io/guardbee-mcp/index/v1.json"]);
    const later = Date.now() + 25 * 3600_000;
    expect((await loadMcpIndex({ cacheFile, fetch: serve(index), now: () => later }))?.source).toBe("network");
  });

  it("falls back to a stale cache when the download fails, and offline uses only the cache", async () => {
    expect(await loadMcpIndex({ cacheFile, offline: true })).toBeUndefined();
    expect(await loadMcpIndex({ cacheFile, fetch: serve({}, 503) })).toBeUndefined();
    await loadMcpIndex({ cacheFile, fetch: serve(index) });
    const later = Date.now() + 48 * 3600_000;
    expect((await loadMcpIndex({ cacheFile, fetch: serve({}, 503), now: () => later }))?.source).toBe("stale-cache");
    expect((await loadMcpIndex({ cacheFile, offline: true, now: () => later }))?.source).toBe("cache");
  });

  it("rejects a document that is not an index", async () => {
    expect(await loadMcpIndex({ cacheFile, fetch: serve({ hello: "world" }) })).toBeUndefined();
  });
});
