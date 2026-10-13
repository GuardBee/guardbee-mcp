import { describe, it, expect } from "vitest";
import { discoverFromCT, normalizeCtName } from "../ct.js";
import { enumerateSubdomainsDetailed, formatSubdomainReport } from "../dns.js";
import type { DnsResolver } from "../resolver.js";

// ── Fake CT endpoints ─────────────────────────────────────────────────────────

interface FakeCt {
  /** crt.sh responses in order (status or JSON rows). */
  crtsh?: Array<number | Array<{ name_value: string }>>;
  /** Cert Spotter pages keyed by the `after` id ("" = first page), or a status. */
  certspotter?: Record<string, number | Array<{ id: string; dns_names: string[] }>>;
}

function fakeFetch(fake: FakeCt) {
  const calls: string[] = [];
  let crtshCall = 0;
  const f = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(`${url.hostname}${url.pathname}${url.searchParams.get("after") ? `?after=${url.searchParams.get("after")}` : ""}`);
    if (url.hostname === "crt.sh") {
      const r = fake.crtsh?.[crtshCall++] ?? 502;
      return typeof r === "number" ? new Response("err", { status: r }) : Response.json(r);
    }
    if (url.hostname === "api.certspotter.com") {
      if (url.pathname !== "/v1/issuances") return new Response("not found", { status: 404 });
      const r = fake.certspotter?.[url.searchParams.get("after") ?? ""] ?? [];
      return typeof r === "number" ? new Response("err", { status: r }) : Response.json(r);
    }
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("normalizeCtName", () => {
  it("strips wildcards and dots, keeps only names under the domain", () => {
    expect(normalizeCtName("*.API.Example.com.", "example.com")).toBe("api.example.com");
    expect(normalizeCtName("example.com", "example.com")).toBeNull();
    expect(normalizeCtName("*.example.com", "example.com")).toBeNull();
    expect(normalizeCtName("evil-example.com", "example.com")).toBeNull();
    expect(normalizeCtName("api.example.com.attacker.net", "example.com")).toBeNull();
    expect(normalizeCtName("bad name.example.com", "example.com")).toBeNull();
  });
});

describe("discoverFromCT", () => {
  it("merges both sources and splits crt.sh multi-line name_value", async () => {
    const { f } = fakeFetch({
      crtsh: [[{ name_value: "api.example.com\n*.dev.example.com" }, { name_value: "API.example.com" }]],
      certspotter: { "": [{ id: "1", dns_names: ["vpn.example.com", "api.example.com", "other.org"] }] },
    });
    const res = await discoverFromCT("example.com", { fetch: f });
    expect(res.names).toEqual(["api.example.com", "dev.example.com", "vpn.example.com"]);
    expect(res.sources).toEqual([
      { source: "crt.sh", ok: true, count: 2 },
      { source: "certspotter", ok: true, count: 2 },
    ]);
    expect(res.truncated).toBe(false);
  });

  it("retries crt.sh once on a 5xx", async () => {
    const { f, calls } = fakeFetch({ crtsh: [502, [{ name_value: "a.example.com" }]] });
    const res = await discoverFromCT("example.com", { fetch: f, retryDelayMs: 0 });
    expect(res.names).toEqual(["a.example.com"]);
    expect(calls.filter((c) => c.startsWith("crt.sh"))).toHaveLength(2);
  });

  it("does not retry crt.sh on a 4xx", async () => {
    const { f, calls } = fakeFetch({ crtsh: [429, [{ name_value: "a.example.com" }]] });
    const res = await discoverFromCT("example.com", { fetch: f, retryDelayMs: 0 });
    expect(res.sources[0]).toEqual({ source: "crt.sh", ok: false, count: 0, error: "HTTP 429" });
    expect(calls.filter((c) => c.startsWith("crt.sh"))).toHaveLength(1);
  });

  it("pages Cert Spotter with ?after=<last id> under /v1, and keeps earlier pages when a later one fails", async () => {
    const { f, calls } = fakeFetch({
      crtsh: [502, 502],
      certspotter: {
        "": [{ id: "10", dns_names: ["a.example.com"] }],
        "10": [{ id: "20", dns_names: ["b.example.com"] }],
        "20": 429,
      },
    });
    const res = await discoverFromCT("example.com", { fetch: f, retryDelayMs: 0 });
    expect(res.names).toEqual(["a.example.com", "b.example.com"]);
    expect(calls.filter((c) => c.startsWith("api.certspotter.com"))).toEqual([
      "api.certspotter.com/v1/issuances",
      "api.certspotter.com/v1/issuances?after=10",
      "api.certspotter.com/v1/issuances?after=20",
    ]);
    expect(res.sources[1]).toMatchObject({ ok: true, count: 2 });
  });

  it("reports both sources as unavailable without throwing", async () => {
    const { f } = fakeFetch({ crtsh: [502, 502], certspotter: { "": 503 } });
    const res = await discoverFromCT("example.com", { fetch: f, retryDelayMs: 0 });
    expect(res.names).toEqual([]);
    expect(res.sources.map((s) => [s.ok, s.error])).toEqual([
      [false, "HTTP 502"],
      [false, "HTTP 503"],
    ]);
  });

  it("caps the number of names", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ name_value: `h${String(i).padStart(2, "0")}.example.com` }));
    const { f } = fakeFetch({ crtsh: [rows] });
    const res = await discoverFromCT("example.com", { fetch: f, maxNames: 10 });
    expect(res.names).toHaveLength(10);
    expect(res.truncated).toBe(true);
  });
});

// ── Enumeration with CT ───────────────────────────────────────────────────────

function fakeResolver(a: Record<string, string>): DnsResolver {
  const err = (code: string) => Object.assign(new Error(code), { code });
  const has = (n: string) => n in a || `*.${n.split(".").slice(1).join(".")}` in a;
  const ip = (n: string) => a[n] ?? a[`*.${n.split(".").slice(1).join(".")}`];
  const nodata = async (n: string) => {
    throw err(has(n) ? "ENODATA" : "ENOTFOUND");
  };
  return {
    resolve4: (async (n: string) => {
      if (!has(n)) throw err("ENOTFOUND");
      return [{ address: ip(n)!, ttl: 60 }];
    }) as unknown as DnsResolver["resolve4"],
    resolve6: nodata as unknown as DnsResolver["resolve6"],
    resolveCname: nodata as unknown as DnsResolver["resolveCname"],
    resolveNs: nodata as unknown as DnsResolver["resolveNs"],
    resolveMx: nodata as unknown as DnsResolver["resolveMx"],
    resolveTxt: nodata as unknown as DnsResolver["resolveTxt"],
    resolveSoa: nodata as unknown as DnsResolver["resolveSoa"],
  };
}

describe("enumerateSubdomainsDetailed with Certificate Transparency", () => {
  it("adds live CT names, tags where each name came from, and counts CT names that resolve", async () => {
    const r = fakeResolver({ "www.example.com": "1.1.1.1", "panel.example.com": "2.2.2.2" });
    const { f } = fakeFetch({ crtsh: [[{ name_value: "panel.example.com\nold.example.com\nwww.example.com" }]] });
    const res = await enumerateSubdomainsDetailed("example.com", 50, { resolver: r, fetch: f, ct: { retryDelayMs: 0 } });
    expect(res.results.map((x) => [x.subdomain, x.sources])).toEqual([
      ["www.example.com", ["wordlist", "ct"]],
      ["panel.example.com", ["ct"]],
    ]);
    expect(res.ct).toMatchObject({ names: ["old.example.com", "panel.example.com", "www.example.com"], resolving: 2 });
    const text = formatSubdomainReport("example.com", res.results, res.wildcard, res.ct);
    expect(text).toContain("Certificate Transparency: 3 name(s) (crt.sh 3, certspotter 0), 2 resolve now");
    expect(text).toMatch(/panel\.example\.com\s+2\.2\.2\.2\s+\[CT\]/);
  });

  it("filters CT names answered only by a wildcard", async () => {
    const r = fakeResolver({ "*.example.com": "9.9.9.9", "real.example.com": "3.3.3.3" });
    const { f } = fakeFetch({ crtsh: [[{ name_value: "ghost.example.com\nreal.example.com" }]] });
    const res = await enumerateSubdomainsDetailed("example.com", 50, { resolver: r, fetch: f, ct: true });
    expect(res.results.map((x) => x.subdomain)).toEqual(["real.example.com"]);
  });

  it("does not contact CT services unless asked", async () => {
    const { f, calls } = fakeFetch({});
    await enumerateSubdomainsDetailed("example.com", 50, { resolver: fakeResolver({}), fetch: f });
    expect(calls).toEqual([]);
  });

  it("says when no CT source answered", async () => {
    const { f } = fakeFetch({ crtsh: [502, 502], certspotter: { "": 503 } });
    const res = await enumerateSubdomainsDetailed("example.com", 50, { resolver: fakeResolver({}), fetch: f, ct: { retryDelayMs: 0 } });
    const text = formatSubdomainReport("example.com", res.results, res.wildcard, res.ct);
    expect(text).toContain("unavailable: crt.sh: HTTP 502; certspotter: HTTP 503");
    expect(text).toContain("Only the built-in wordlist was used");
  });
});
