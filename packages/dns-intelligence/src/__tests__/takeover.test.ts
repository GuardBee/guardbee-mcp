import { describe, it, expect } from "vitest";
import { checkTakeover, registrableDomain, FINGERPRINTS } from "../takeover.js";
import { enumerateSubdomainsDetailed, formatSubdomainReport } from "../dns.js";
import type { DnsResolver } from "../resolver.js";

// ── Fakes ─────────────────────────────────────────────────────────────────────

type Zone = Record<string, { CNAME?: string[]; A?: string[]; NS?: string[] } | "SERVFAIL">;

function err(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function fakeResolver(zone: Zone): DnsResolver {
  const entry = (name: string) => zone[name] ?? zone[`*.${name.split(".").slice(1).join(".")}`];
  const get = (type: "CNAME" | "A" | "NS") => async (name: string) => {
    const e = entry(name);
    if (!e) throw err("ENOTFOUND");
    if (e === "SERVFAIL") throw err("ESERVFAIL");
    const v = e[type];
    if (!v) throw err("ENODATA");
    return type === "A" ? v.map((address) => ({ address, ttl: 60 })) : v;
  };
  const nodata = async (name: string) => {
    if (!entry(name)) throw err("ENOTFOUND");
    throw err("ENODATA");
  };
  return {
    resolve4: get("A") as unknown as DnsResolver["resolve4"],
    resolve6: nodata as unknown as DnsResolver["resolve6"],
    resolveCname: get("CNAME") as unknown as DnsResolver["resolveCname"],
    resolveNs: get("NS") as unknown as DnsResolver["resolveNs"],
    resolveMx: nodata as unknown as DnsResolver["resolveMx"],
    resolveTxt: nodata as unknown as DnsResolver["resolveTxt"],
    resolveSoa: nodata as unknown as DnsResolver["resolveSoa"],
  };
}

/** Pages served per hostname; "TLS" fails HTTPS (as for S3 custom domains). */
function fakeFetch(pages: Record<string, { status: number; body: string } | "TLS">) {
  const calls: string[] = [];
  const f = (async (url: string | URL) => {
    const u = new URL(String(url));
    calls.push(`${u.protocol}//${u.hostname}`);
    const page = pages[u.hostname];
    if (page === "TLS" && u.protocol === "https:") throw new TypeError("fetch failed");
    if (!page || page === "TLS") {
      const httpPage = pages[`http:${u.hostname}`];
      if (httpPage && httpPage !== "TLS" && u.protocol === "http:") return new Response(httpPage.body, { status: httpPage.status });
      throw new TypeError("fetch failed");
    }
    return new Response(page.body, { status: page.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

// ── checkTakeover ─────────────────────────────────────────────────────────────

describe("checkTakeover", () => {
  it("returns null for a host without a CNAME", async () => {
    expect(await checkTakeover("www.example.com", fakeResolver({ "www.example.com": { A: ["1.1.1.1"] } }))).toBeNull();
  });

  it("flags an Azure CNAME whose target no longer exists, and only then", async () => {
    const gone = fakeResolver({ "app.example.com": { CNAME: ["old-app.azurewebsites.net"] } });
    expect(await checkTakeover("app.example.com", gone)).toMatchObject({
      provider: "Microsoft Azure",
      risk: "vulnerable",
      chain: ["old-app.azurewebsites.net"],
    });
    const alive = fakeResolver({
      "app.example.com": { CNAME: ["live.azurewebsites.net"] },
      "live.azurewebsites.net": { A: ["20.1.1.1"] },
    });
    expect(await checkTakeover("app.example.com", alive)).toBeNull();
  });

  it("matches the provider at any hop of the CNAME chain", async () => {
    const r = fakeResolver({
      "files.example.com": { CNAME: ["cdn.example.net"] },
      "cdn.example.net": { CNAME: ["gone-bucket.s3.amazonaws.com"] },
      "gone-bucket.s3.amazonaws.com": { CNAME: ["s3-1-w.amazonaws.com"] },
      "s3-1-w.amazonaws.com": { A: ["52.1.1.1"] },
    });
    const { f } = fakeFetch({ "files.example.com": { status: 404, body: "<Code>NoSuchBucket</Code>" } });
    const t = await checkTakeover("files.example.com", r, { fetch: f });
    expect(t).toMatchObject({ provider: "AWS S3", risk: "vulnerable" });
    expect(t!.chain).toEqual(["cdn.example.net", "gone-bucket.s3.amazonaws.com", "s3-1-w.amazonaws.com"]);
    expect(t!.evidence).toBe('HTTP 404: page says "NoSuchBucket"');
  });

  it("falls back to HTTP when HTTPS fails (custom domain without a certificate)", async () => {
    const r = fakeResolver({ "b.example.com": { CNAME: ["x.s3.amazonaws.com"] }, "x.s3.amazonaws.com": { A: ["52.1.1.1"] } });
    const { f, calls } = fakeFetch({ "b.example.com": "TLS", "http:b.example.com": { status: 404, body: "NoSuchBucket" } });
    expect(await checkTakeover("b.example.com", r, { fetch: f })).toMatchObject({ provider: "AWS S3" });
    expect(calls).toEqual(["https://b.example.com", "http://b.example.com"]);
  });

  it("does not flag a provider CNAME whose page is served normally", async () => {
    const r = fakeResolver({ "docs.example.com": { CNAME: ["org.github.io"] }, "org.github.io": { A: ["185.199.108.153"] } });
    const { f } = fakeFetch({ "docs.example.com": { status: 200, body: "<h1>Docs</h1>" } });
    expect(await checkTakeover("docs.example.com", r, { fetch: f })).toBeNull();
  });

  it("marks providers with domain verification as edge cases", async () => {
    const r = fakeResolver({ "docs.example.com": { CNAME: ["org.github.io"] }, "org.github.io": { A: ["185.199.108.153"] } });
    const { f } = fakeFetch({ "docs.example.com": { status: 404, body: "There isn't a GitHub Pages site here." } });
    expect(await checkTakeover("docs.example.com", r, { fetch: f })).toMatchObject({ provider: "GitHub Pages", risk: "edge" });
  });

  it("skips HTTP fingerprints when http is false", async () => {
    const r = fakeResolver({ "docs.example.com": { CNAME: ["org.github.io"] }, "org.github.io": { A: ["185.199.108.153"] } });
    const { f, calls } = fakeFetch({ "docs.example.com": { status: 404, body: "There isn't a GitHub Pages site here." } });
    expect(await checkTakeover("docs.example.com", r, { fetch: f, http: false })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("an unknown target under an unregistered domain is a takeover; under a registered one it is stale", async () => {
    const unregistered = fakeResolver({ "promo.example.com": { CNAME: ["www.expired-campaign.com"] } });
    expect(await checkTakeover("promo.example.com", unregistered)).toMatchObject({
      provider: "unregistered domain",
      risk: "vulnerable",
    });
    const registered = fakeResolver({
      "old.example.com": { CNAME: ["gone.example.net"] },
      "example.net": { NS: ["ns1.example.net"] },
    });
    expect(await checkTakeover("old.example.com", registered)).toMatchObject({ provider: "example.net", risk: "stale" });
    // A failed NS query is not proof that the domain is unregistered.
    const flaky = fakeResolver({ "old.example.com": { CNAME: ["gone.example.org"] }, "example.org": "SERVFAIL" });
    expect(await checkTakeover("old.example.com", flaky)).toMatchObject({ risk: "stale" });
    const reserved = fakeResolver({ "x.example.com": { CNAME: ["y.example.invalid"] } });
    expect(await checkTakeover("x.example.com", reserved)).toMatchObject({ risk: "stale" });
  });
});

describe("registrableDomain", () => {
  it("approximates the registrable domain without a suffix list", () => {
    expect(registrableDomain("a.b.example.com")).toBe("example.com");
    expect(registrableDomain("x.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("shop.example.com.tr.")).toBe("example.com.tr");
    expect(registrableDomain("example.io")).toBe("example.io");
  });
});

describe("FINGERPRINTS", () => {
  it("every CNAME pattern is anchored at the end and every page marker is non-empty", () => {
    for (const fp of FINGERPRINTS) {
      expect(fp.cname.source.endsWith("$")).toBe(true);
      if (fp.match.kind === "http") expect(fp.match.body.every((b) => b.length >= 6)).toBe(true);
    }
  });

  it("does not match look-alike hostnames", () => {
    const hits = (h: string) => FINGERPRINTS.filter((f) => f.cname.test(h)).map((f) => f.provider);
    expect(hits("evil-github.io.attacker.com")).toEqual([]);
    expect(hits("evilgithub.io")).toEqual([]);
    expect(hits("notazurewebsites.net")).toEqual([]);
    expect(hits("bucket.s3.amazonaws.com")).toEqual(["AWS S3"]);
    expect(hits("site.github.io")).toEqual(["GitHub Pages"]);
    expect(hits("mynotsurge.sh")).toEqual([]);
  });
});

// ── Enumeration ───────────────────────────────────────────────────────────────

describe("enumerateSubdomainsDetailed with takeover checks", () => {
  it("dangling only for real takeovers; stale records are listed but not dangling", async () => {
    const r = fakeResolver({
      "blog.example.com": { CNAME: ["old.azurewebsites.net"] },
      "dev.example.com": { CNAME: ["gone.example.net"] },
      "example.net": { NS: ["ns1"] },
      "www.example.com": { A: ["1.1.1.1"] },
    });
    const { results } = await enumerateSubdomainsDetailed("example.com", 50, { resolver: r, http: false });
    const by = Object.fromEntries(results.map((x) => [x.subdomain, x]));
    expect(by["blog.example.com"]!.dangling).toBe(true);
    expect(by["dev.example.com"]!.dangling).toBeUndefined();
    expect(by["dev.example.com"]!.takeover!.risk).toBe("stale");
    const text = formatSubdomainReport("example.com", results);
    expect(text).toContain("1 potentially dangling");
    expect(text).toContain("🧹 STALE");
  });

  it("checks a wildcard CNAME for takeover", async () => {
    const r = fakeResolver({ "*.example.com": { CNAME: ["gone.azurewebsites.net"] }, "www.example.com": { A: ["1.1.1.1"] } });
    const { wildcard, results } = await enumerateSubdomainsDetailed("example.com", 50, { resolver: r, http: false });
    expect(wildcard!.takeover).toMatchObject({ provider: "Microsoft Azure", risk: "vulnerable" });
    expect(formatSubdomainReport("example.com", results, wildcard)).toContain("WILDCARD TAKEOVER (Microsoft Azure)");
  });
});
