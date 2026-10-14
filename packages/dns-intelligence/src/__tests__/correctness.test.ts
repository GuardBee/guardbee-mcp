import { describe, it, expect } from "vitest";
import { analyzeSpf, analyzeDmarc, enumerateDomain, enumerateSubdomainsDetailed, formatSubdomainReport } from "../dns.js";
import { countLookupTerms, evaluateSpf, isSpfRecord } from "../spf.js";
import { normalizeDomain, type DnsResolver } from "../resolver.js";
import { generateKeyPairSync } from "crypto";

const RSA_2048 = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "der" }).toString("base64");

// ── Fake resolver ─────────────────────────────────────────────────────────────
//
// zone["name"] = { TXT: [...], A: [...], CNAME: [...], ... }. A name that is not
// in the zone (and matches no "*." entry) is NXDOMAIN; a missing type is NODATA;
// "SERVFAIL" makes every query for that name fail.

type Zone = Record<string, Partial<Record<"A" | "AAAA" | "MX" | "NS" | "TXT" | "CNAME" | "SOA", unknown>> | "SERVFAIL">;

function err(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function fakeResolver(zone: Zone): DnsResolver & { queries: string[] } {
  const queries: string[] = [];
  const entry = (name: string) => {
    const n = name.toLowerCase();
    if (n in zone) return zone[n]!;
    const wild = `*.${n.split(".").slice(1).join(".")}`;
    return zone[wild];
  };
  const get = (type: string) => async (name: string) => {
    queries.push(`${type} ${name}`);
    const e = entry(name);
    if (e === undefined) throw err("ENOTFOUND");
    if (e === "SERVFAIL") throw err("ESERVFAIL");
    const v = (e as Record<string, unknown>)[type];
    if (v === undefined) throw err("ENODATA");
    return v;
  };
  return {
    queries,
    resolve4: get("A") as unknown as DnsResolver["resolve4"],
    resolve6: get("AAAA") as unknown as DnsResolver["resolve6"],
    resolveMx: get("MX") as unknown as DnsResolver["resolveMx"],
    resolveNs: get("NS") as unknown as DnsResolver["resolveNs"],
    resolveTxt: get("TXT") as unknown as DnsResolver["resolveTxt"],
    resolveCname: get("CNAME") as unknown as DnsResolver["resolveCname"],
    resolveSoa: get("SOA") as unknown as DnsResolver["resolveSoa"],
  };
}

const txt = (...records: string[]) => records.map((r) => [r]);
const a = (...ips: string[]) => ips.map((address) => ({ address, ttl: 300 }));
const SOA = { nsname: "ns1.example.com", hostmaster: "h.example.com", serial: 1, refresh: 1, retry: 1, expire: 1, minttl: 1 };

// ── SPF term counting ─────────────────────────────────────────────────────────

describe("countLookupTerms", () => {
  it("does not count 'all' as the 'a' mechanism", () => {
    for (const all of ["-all", "~all", "?all", "+all", "all"]) {
      expect(countLookupTerms(`v=spf1 ip4:1.2.3.4 ${all}`)).toBe(0);
    }
  });

  it("counts every DNS-querying term and nothing else", () => {
    const rec = "v=spf1 a a:x.com a/24 mx mx:y.com ptr exists:%{i}.z.com include:z.com redirect=r.com ip4:1.1.1.1 ip6:::1 exp=e.com -all";
    expect(countLookupTerms(rec)).toBe(9);
  });

  it("matches GitHub's real record: 8 includes, not 9", () => {
    const github =
      "v=spf1 ip4:192.30.252.0/22 include:spf.protection.outlook.com include:_netblocks.google.com include:_netblocks2.google.com include:mail.zendesk.com include:_spf.salesforce.com include:servers.mcsv.net include:mktomail.com include:sendgrid.net ip4:62.253.227.114 ~all";
    expect(analyzeSpf([{ type: "TXT", value: github }])!.lookupCount).toBe(8);
  });

  it("recognises v=spf1 case-insensitively but not v=spf10", () => {
    expect(isSpfRecord("V=SPF1 -all")).toBe(true);
    expect(isSpfRecord("v=spf1")).toBe(true);
    expect(isSpfRecord("v=spf10 -all")).toBe(false);
  });
});

// ── Nested SPF evaluation ─────────────────────────────────────────────────────

describe("evaluateSpf", () => {
  it("counts lookups inside includes and redirects", async () => {
    const r = fakeResolver({
      "inc1.com": { TXT: txt("v=spf1 include:inc2.com mx -all") },
      "inc2.com": { TXT: txt("v=spf1 a ip4:1.1.1.1 -all") },
      "redir.com": { TXT: txt("v=spf1 exists:x.redir.com -all") },
    });
    const res = await evaluateSpf("example.com", "v=spf1 include:inc1.com redirect=redir.com", r);
    // include:inc1 (1) + include:inc2 (1) + mx (1) + a (1) + redirect (1) + exists (1)
    expect(res.lookups).toBe(6);
    expect(res.included).toEqual(["inc1.com", "inc2.com", "redir.com"]);
    expect(res.issues).toEqual([]);
  });

  it("flags more than 10 lookups and stops following includes", async () => {
    const zone: Zone = {};
    for (let i = 0; i < 6; i++) zone[`i${i}.com`] = { TXT: txt("v=spf1 a mx -all") };
    const r = fakeResolver(zone);
    const res = await evaluateSpf("example.com", `v=spf1 ${[0, 1, 2, 3, 4, 5].map((i) => `include:i${i}.com`).join(" ")} -all`, r);
    expect(res.lookups).toBeGreaterThan(10);
    expect(res.issues[0]!.code).toBe("SPF_TOO_MANY_LOOKUPS");
    expect(r.queries.length).toBeLessThan(6);
  });

  it("warns at exactly 10", async () => {
    const r = fakeResolver({ "x.com": { TXT: txt("v=spf1 a a a a a a a a -all") } });
    const res = await evaluateSpf("example.com", "v=spf1 a include:x.com", r);
    expect(res.lookups).toBe(10);
    expect(res.issues.map((i) => i.code)).toEqual(["SPF_AT_LOOKUP_LIMIT"]);
  });

  it("counts void lookups and flags more than two", async () => {
    const r = fakeResolver({ "nospf.com": { TXT: txt("google-site-verification=x") } });
    const res = await evaluateSpf("example.com", "v=spf1 include:gone1.com include:gone2.com include:gone3.com include:nospf.com -all", r);
    expect(res.voidLookups).toBe(3);
    const codes = res.issues.map((i) => i.code);
    expect(codes.filter((c) => c === "SPF_INCLUDE_MISSING")).toHaveLength(4);
    expect(codes).toContain("SPF_TOO_MANY_VOID_LOOKUPS");
  });

  it("detects include loops", async () => {
    const r = fakeResolver({ "b.com": { TXT: txt("v=spf1 include:example.com -all") } });
    const res = await evaluateSpf("example.com", "v=spf1 include:b.com -all", r);
    expect(res.issues.map((i) => i.code)).toContain("SPF_INCLUDE_LOOP");
  });

  it("reports duplicate SPF records in an include, ptr, macros and failed queries", async () => {
    const r = fakeResolver({ "dup.com": { TXT: txt("v=spf1 -all", "v=spf1 ~all") }, "broken.com": "SERVFAIL" });
    const res = await evaluateSpf("example.com", "v=spf1 ptr include:dup.com include:%{d}.mac.com include:broken.com -all", r);
    expect(res.issues.map((i) => i.code).sort()).toEqual(
      ["SPF_INCLUDE_DUPLICATE", "SPF_INCLUDE_UNRESOLVED", "SPF_MACROS", "SPF_PTR"].sort()
    );
    expect(res.voidLookups).toBe(0); // SERVFAIL is not a void lookup
  });
});

// ── DMARC parsing ─────────────────────────────────────────────────────────────

describe("analyzeDmarc", () => {
  it("parses tags case-insensitively and keeps '=' inside values", () => {
    const d = analyzeDmarc("v=DMARC1; P=Reject; RUA=mailto:a@b.com?subject=x, mailto:c@d.com")!;
    expect(d.policy).toBe("reject");
    expect(d.rua).toEqual(["mailto:a@b.com?subject=x", "mailto:c@d.com"]);
    expect(d.issues).toEqual([]);
  });

  it("rejects an unknown policy value", () => {
    const d = analyzeDmarc("v=DMARC1; p=block; rua=mailto:a@b.com")!;
    expect(d.valid).toBe(false);
    expect(d.issues.map((i) => i.code)).toEqual(["DMARC_INVALID_POLICY"]);
  });

  it("flags pct<100 for reject too, and sp=none", () => {
    const d = analyzeDmarc("v=DMARC1; p=reject; pct=25; sp=none; rua=mailto:a@b.com")!;
    expect(d.subdomainPolicy).toBe("none");
    expect(d.issues.map((i) => i.code)).toEqual(["DMARC_PCT_LOW", "DMARC_SUBDOMAINS_NONE"]);
  });
});

// ── enumerateDomain ───────────────────────────────────────────────────────────

describe("enumerateDomain", () => {
  it("reports a domain that does not exist instead of missing SPF/DMARC", async () => {
    const res = await enumerateDomain("gone.example", { resolver: fakeResolver({}) });
    expect(res.exists).toBe(false);
    expect(res.findings.map((f) => f.code)).toEqual(["DOMAIN_NOT_FOUND"]);
  });

  it("uses the nested SPF count, not the record's own", async () => {
    const zone: Zone = {
      "example.com": { SOA, NS: ["a.ns", "b.ns"], TXT: txt("v=spf1 include:big.com -all") },
      "big.com": { TXT: txt("v=spf1 a a a a a a a a a a -all") },
      "_dmarc.example.com": { TXT: txt("v=DMARC1; p=reject; rua=mailto:d@example.com") },
      "google._domainkey.example.com": { TXT: txt(`v=DKIM1; k=rsa; p=${RSA_2048}`) },
    };
    const res = await enumerateDomain("example.com", { resolver: fakeResolver(zone) });
    expect(res.spf!.lookupCount).toBe(1);
    expect(res.spf!.totalLookups).toBe(11);
    expect(res.findings.map((f) => f.code)).toEqual(["SPF_TOO_MANY_LOOKUPS"]);
    expect(res.zoneTransferVulnerable).toBeUndefined();
  });

  it("inherits the parent's DMARC with its subdomain policy", async () => {
    const zone: Zone = {
      "mail.example.com": { A: a("1.2.3.4") },
      "_dmarc.example.com": { TXT: txt("v=DMARC1; p=reject; sp=none; rua=mailto:d@example.com") },
    };
    const res = await enumerateDomain("mail.example.com", { resolver: fakeResolver(zone) });
    expect(res.dmarc!.inheritedFrom).toBe("_dmarc.example.com");
    expect(res.dmarc!.policy).toBe("none");
    const codes = res.findings.map((f) => f.code);
    expect(codes).toContain("DMARC_POLICY_NONE");
    expect(codes).not.toContain("DMARC_MISSING");
    expect(codes).not.toContain("NS_MISSING"); // a host, not a zone apex
  });

  it("treats two DMARC records as none", async () => {
    const zone: Zone = {
      "example.com": { SOA, NS: ["a.ns", "b.ns"] },
      "_dmarc.example.com": { TXT: txt("v=DMARC1; p=reject", "v=DMARC1; p=none") },
    };
    const res = await enumerateDomain("example.com", { resolver: fakeResolver(zone) });
    expect(res.dmarc).toBeUndefined();
    expect(res.findings.map((f) => f.code)).toContain("DMARC_MULTIPLE");
  });

  it("normalizes URLs and case", async () => {
    const res = await enumerateDomain("https://Example.COM./path", { resolver: fakeResolver({ "example.com": { SOA, NS: ["a", "b"] } }) });
    expect(res.domain).toBe("example.com");
  });
});

// ── Subdomains and wildcard DNS ───────────────────────────────────────────────

describe("enumerateSubdomainsDetailed", () => {
  it("hides names answered only by a wildcard A record", async () => {
    const r = fakeResolver({
      "*.example.com": { A: a("9.9.9.9") },
      "api.example.com": { A: a("1.2.3.4") },
    });
    const { results, wildcard } = await enumerateSubdomainsDetailed("example.com", 50, { resolver: r });
    expect(results.map((x) => x.subdomain)).toEqual(["api.example.com"]);
    expect(wildcard!.addresses).toEqual(["9.9.9.9"]);
    expect(wildcard!.hidden).toBeGreaterThan(70);
    expect(formatSubdomainReport("example.com", results, wildcard)).toContain("Wildcard DNS: *.example.com → 9.9.9.9");
  });

  it("hides names answered only by a wildcard CNAME, even when a real name shares its CDN address", async () => {
    const r = fakeResolver({
      "*.example.com": { CNAME: ["lb.host.net"], A: a("5.5.5.5") },
      "shop.example.com": { CNAME: ["shops.myshopify.com"], A: a("5.5.5.5") },
    });
    const { results, wildcard } = await enumerateSubdomainsDetailed("example.com", 50, { resolver: r });
    expect(results.map((x) => x.subdomain)).toEqual(["shop.example.com"]);
    expect(wildcard!.cname).toBe("lb.host.net");
  });

  it("without a wildcard, keeps live names and flags a CNAME to a missing provider resource", async () => {
    const r = fakeResolver({
      "www.example.com": { A: a("1.1.1.1") },
      "blog.example.com": { CNAME: ["old.azurewebsites.net"] },
    });
    const { results, wildcard } = await enumerateSubdomainsDetailed("example.com", 50, { resolver: r });
    expect(wildcard).toBeUndefined();
    expect(results.map((x) => [x.subdomain, !!x.dangling])).toEqual([
      ["www.example.com", false],
      ["blog.example.com", true],
    ]);
  });
});

describe("normalizeDomain", () => {
  it("accepts hostnames and URLs, rejects the rest", () => {
    expect(normalizeDomain(" Example.com. ")).toBe("example.com");
    expect(normalizeDomain("http://sub.example.co.uk:8080/x?y")).toBe("sub.example.co.uk");
    expect(normalizeDomain("_dmarc.example.com")).toBe("_dmarc.example.com");
    for (const bad of ["", "not a domain", "localhost", "example..com", "-x.com"]) {
      expect(() => normalizeDomain(bad)).toThrow();
    }
  });
});
