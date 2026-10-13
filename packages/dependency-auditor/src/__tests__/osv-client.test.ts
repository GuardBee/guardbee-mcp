import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { queryOsvBatch, clearOsvCache, getSeverity, getFixedVersion } from "../osv.js";
import type { OsvVuln } from "../osv.js";

// ── Fake OSV API ──────────────────────────────────────────────────────────────
//
// querybatch answers with `{ id, modified }` only, like the real endpoint.
// Full records come from GET /vulns/{id}.

const RECORDS: Record<string, OsvVuln> = {
  "GHSA-crit": {
    id: "GHSA-crit",
    summary: "Prototype pollution",
    aliases: ["CVE-2020-0001"],
    severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
    affected: [
      {
        package: { name: "lodash", ecosystem: "npm" },
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
      },
    ],
  },
  "GHSA-med": {
    id: "GHSA-med",
    summary: "ReDoS",
    database_specific: { severity: "MODERATE" },
  },
};

type BatchQuery = { package: { name: string }; version: string; page_token?: string };

interface FakeOptions {
  /** Package name → advisory IDs per page. */
  pages: Record<string, string[][]>;
  /** IDs whose GET returns this status. */
  failIds?: Record<string, number>;
}

function installFakeOsv(opts: FakeOptions) {
  const calls = { batch: 0, get: [] as string[] };
  const fake = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/querybatch")) {
      calls.batch++;
      const body = JSON.parse(String(init?.body)) as { queries: BatchQuery[] };
      const results = body.queries.map((q) => {
        const pages = opts.pages[q.package.name] ?? [[]];
        const page = q.page_token ? Number(q.page_token) : 0;
        const ids = pages[page] ?? [];
        return {
          vulns: ids.map((id) => ({ id, modified: "2026-01-01T00:00:00Z" })),
          ...(page + 1 < pages.length ? { next_page_token: String(page + 1) } : {}),
        };
      });
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    const id = decodeURIComponent(url.split("/vulns/")[1] ?? "");
    calls.get.push(id);
    const status = opts.failIds?.[id];
    if (status) return new Response("err", { status });
    const rec = RECORDS[id] ?? { id };
    return new Response(JSON.stringify(rec), { status: 200 });
  });
  vi.stubGlobal("fetch", fake);
  return calls;
}

beforeEach(() => {
  clearOsvCache();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("queryOsvBatch", () => {
  it("hydrates the minimal batch records into full advisories", async () => {
    installFakeOsv({ pages: { lodash: [["GHSA-crit", "GHSA-med"]] } });
    const [res] = await queryOsvBatch([{ name: "lodash", version: "4.17.15", ecosystem: "npm" }]);

    expect(res!.vulns.map((v) => v.id)).toEqual(["GHSA-crit", "GHSA-med"]);
    const crit = res!.vulns[0]!;
    expect(crit.summary).toBe("Prototype pollution");
    expect(crit.aliases).toContain("CVE-2020-0001");
    expect(getSeverity(crit)).toBe("critical");
    expect(getFixedVersion(crit, "lodash", "4.17.15", "npm")).toBe("4.17.21");
    expect(getSeverity(res!.vulns[1]!)).toBe("medium");
  });

  it("fetches each advisory once even when several packages share it", async () => {
    const calls = installFakeOsv({
      pages: { a: [["GHSA-crit"]], b: [["GHSA-crit", "GHSA-med"]] },
    });
    const res = await queryOsvBatch([
      { name: "a", version: "1.0.0", ecosystem: "npm" },
      { name: "b", version: "1.0.0", ecosystem: "npm" },
    ]);
    expect(res.map((r) => r.vulns.length)).toEqual([1, 2]);
    expect(calls.get.sort()).toEqual(["GHSA-crit", "GHSA-med"]);
  });

  it("follows next_page_token for a package with many advisories", async () => {
    const calls = installFakeOsv({ pages: { big: [["GHSA-crit"], ["GHSA-med"], ["GHSA-x"]] } });
    const [res] = await queryOsvBatch([{ name: "big", version: "1.0.0", ecosystem: "npm" }]);
    expect(res!.vulns.map((v) => v.id)).toEqual(["GHSA-crit", "GHSA-med", "GHSA-x"]);
    expect(calls.batch).toBe(3);
  });

  it("returns an empty list for packages without advisories, without GET calls", async () => {
    const calls = installFakeOsv({ pages: {} });
    const [res] = await queryOsvBatch([{ name: "clean", version: "1.0.0", ecosystem: "npm" }]);
    expect(res!.vulns).toEqual([]);
    expect(calls.get).toEqual([]);
  });

  it("retries a transient 5xx when fetching an advisory", async () => {
    let failures = 1;
    const calls = installFakeOsv({ pages: { lodash: [["GHSA-crit"]] } });
    const inner = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/vulns/") && failures > 0) {
        failures--;
        return new Response("busy", { status: 503 });
      }
      return inner(url, init);
    });
    const [res] = await queryOsvBatch([{ name: "lodash", version: "4.17.15", ecosystem: "npm" }]);
    expect(getSeverity(res!.vulns[0]!)).toBe("critical");
    expect(calls.get).toEqual(["GHSA-crit"]);
  });

  it("throws instead of reporting unknown severity when an advisory cannot be fetched", async () => {
    installFakeOsv({ pages: { lodash: [["GHSA-crit"]] }, failIds: { "GHSA-crit": 503 } });
    await expect(
      queryOsvBatch([{ name: "lodash", version: "4.17.15", ecosystem: "npm" }])
    ).rejects.toThrow(/503/);
  });

  it("throws on a non-retryable error fetching an advisory", async () => {
    installFakeOsv({ pages: { lodash: [["GHSA-crit"]] }, failIds: { "GHSA-crit": 404 } });
    await expect(
      queryOsvBatch([{ name: "lodash", version: "4.17.15", ecosystem: "npm" }])
    ).rejects.toThrow(/GHSA-crit: 404/);
  });
});
