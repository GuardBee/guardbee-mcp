import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "crypto";
import { analyzeDkimRecord, checkMx, checkMtaSts, checkTlsRpt, mxMatches, parseMtaStsPolicy, suggestSpf } from "../email.js";
import { enumerateDomain } from "../dns.js";
import type { DnsResolver } from "../resolver.js";

const rsaKey = (bits: number) =>
  generateKeyPairSync("rsa", { modulusLength: bits }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
const RSA_1024 = rsaKey(1024);
const RSA_2048 = rsaKey(2048);
const RSA_512 = rsaKey(512);

// ── Fakes ─────────────────────────────────────────────────────────────────────

type Entry = { TXT?: string[]; A?: string[]; MX?: Array<{ priority: number; exchange: string }>; NS?: string[]; SOA?: object } | "SERVFAIL";

function fakeResolver(zone: Record<string, Entry>): DnsResolver {
  const err = (code: string) => Object.assign(new Error(code), { code });
  const get = (type: string, wrap: (v: unknown) => unknown = (v) => v) => async (name: string) => {
    const e = zone[name];
    if (!e) throw err("ENOTFOUND");
    if (e === "SERVFAIL") throw err("ESERVFAIL");
    const v = (e as Record<string, unknown>)[type];
    if (!v) throw err("ENODATA");
    return wrap(v);
  };
  return {
    resolve4: get("A", (v) => (v as string[]).map((address) => ({ address, ttl: 60 }))) as unknown as DnsResolver["resolve4"],
    resolve6: get("AAAA") as unknown as DnsResolver["resolve6"],
    resolveMx: get("MX") as unknown as DnsResolver["resolveMx"],
    resolveNs: get("NS") as unknown as DnsResolver["resolveNs"],
    resolveTxt: get("TXT", (v) => (v as string[]).map((s) => [s])) as unknown as DnsResolver["resolveTxt"],
    resolveCname: get("CNAME") as unknown as DnsResolver["resolveCname"],
    resolveSoa: get("SOA") as unknown as DnsResolver["resolveSoa"],
  };
}

function policyFetch(res: { status: number; body?: string } | "ERR") {
  const calls: Array<{ url: string; redirect?: string }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), redirect: init?.redirect });
    if (res === "ERR") throw new TypeError("fetch failed");
    return new Response(res.body ?? "", { status: res.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const POLICY = "version: STSv1\nmode: enforce\nmx: mail.example.com\nmx: *.backup.example.net\nmax_age: 604800\n";

// ── DKIM ──────────────────────────────────────────────────────────────────────

describe("analyzeDkimRecord", () => {
  it("reads the RSA key size from the published key", () => {
    expect(analyzeDkimRecord("s", `v=DKIM1; k=rsa; p=${RSA_2048}`)).toMatchObject({ keyType: "rsa", bits: 2048, issues: [] });
    expect(analyzeDkimRecord("s", `v=DKIM1; p=${RSA_1024}`).issues.map((i) => i.code)).toEqual(["DKIM_KEY_1024"]);
    expect(analyzeDkimRecord("s", `v=DKIM1; p=${RSA_512}`).issues.map((i) => [i.code, i.severity])).toEqual([["DKIM_KEY_WEAK", "high"]]);
  });

  it("handles keys split with whitespace, revoked keys, test mode, Ed25519 and garbage", () => {
    const split = `v=DKIM1; k=rsa; p=${RSA_2048.slice(0, 100)} ${RSA_2048.slice(100)}`;
    expect(analyzeDkimRecord("s", split).bits).toBe(2048);
    expect(analyzeDkimRecord("s", "v=DKIM1; k=rsa; p=")).toMatchObject({ revoked: true });
    expect(analyzeDkimRecord("s", `v=DKIM1; t=y; p=${RSA_2048}`).issues.map((i) => i.code)).toEqual(["DKIM_TESTING"]);
    expect(analyzeDkimRecord("s", "v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=")).toMatchObject({ keyType: "ed25519", issues: [] });
    expect(analyzeDkimRecord("s", "v=DKIM1; p=not-a-key").issues.map((i) => i.code)).toEqual(["DKIM_KEY_INVALID"]);
  });
});

// ── MX ────────────────────────────────────────────────────────────────────────

describe("checkMx", () => {
  it("flags MX hosts that do not resolve, but not ones whose lookup failed", async () => {
    const r = fakeResolver({ "mx1.example.com": { A: ["1.1.1.1"] }, "flaky.example.com": "SERVFAIL" });
    const res = await checkMx(
      [
        { priority: 10, exchange: "mx1.example.com" },
        { priority: 20, exchange: "gone.example.com" },
        { priority: 30, exchange: "flaky.example.com" },
      ],
      r
    );
    expect(res.findings.map((f) => f.message)).toEqual(["MX host gone.example.com has no A/AAAA record; mail sent to it bounces"]);
  });

  it("recognises a null MX", async () => {
    const res = await checkMx([{ priority: 0, exchange: "" }], fakeResolver({}));
    expect(res).toMatchObject({ nullMx: true, hosts: [] });
  });
});

// ── MTA-STS ───────────────────────────────────────────────────────────────────

describe("MTA-STS", () => {
  it("matches wildcard MX patterns by exactly one label", () => {
    expect(mxMatches("*.backup.example.net", "a.backup.example.net")).toBe(true);
    expect(mxMatches("*.backup.example.net", "a.b.backup.example.net")).toBe(false);
    expect(mxMatches("*.backup.example.net", "backup.example.net")).toBe(false);
    expect(mxMatches("mail.example.com", "mail.example.com")).toBe(true);
  });

  it("parses the policy file", () => {
    expect(parseMtaStsPolicy(POLICY.replace(/\n/g, "\r\n"))).toEqual({
      version: "STSv1",
      mode: "enforce",
      mx: ["mail.example.com", "*.backup.example.net"],
      maxAge: 604800,
    });
  });

  const zone = { "_mta-sts.example.com": { TXT: ["v=STSv1; id=20261014"] } };

  it("accepts a correct enforce policy, fetched without following redirects", async () => {
    const { f, calls } = policyFetch({ status: 200, body: POLICY });
    const res = await checkMtaSts("example.com", ["mail.example.com", "x.backup.example.net"], fakeResolver(zone), { fetch: f });
    expect(res.findings).toEqual([]);
    expect(calls).toEqual([{ url: "https://mta-sts.example.com/.well-known/mta-sts.txt", redirect: "manual" }]);
  });

  it("flags an MX the enforce policy does not list (mail to it would be refused)", async () => {
    const { f } = policyFetch({ status: 200, body: POLICY });
    const res = await checkMtaSts("example.com", ["mail.example.com", "new-mx.example.org"], fakeResolver(zone), { fetch: f });
    expect(res.findings.map((x) => [x.code, x.severity])).toEqual([["MTA_STS_MX_MISMATCH", "high"]]);
  });

  it("reports testing mode, a short max_age, and a redirect or error as unusable", async () => {
    const testing = policyFetch({ status: 200, body: POLICY.replace("enforce", "testing").replace("604800", "3600") });
    const res = await checkMtaSts("example.com", ["mail.example.com"], fakeResolver(zone), { fetch: testing.f });
    expect(res.findings.map((x) => x.code)).toEqual(["MTA_STS_TESTING", "MTA_STS_MAX_AGE_SHORT"]);
    for (const resp of [{ status: 301 }, "ERR" as const]) {
      const { f } = policyFetch(resp);
      const r2 = await checkMtaSts("example.com", ["mail.example.com"], fakeResolver(zone), { fetch: f });
      expect(r2.findings.map((x) => x.code)).toEqual(["MTA_STS_POLICY_UNREACHABLE"]);
    }
  });

  it("flags an invalid policy, a record without id, and several records", async () => {
    const { f } = policyFetch({ status: 200, body: "mode: enforce\nmx: mail.example.com" });
    expect((await checkMtaSts("example.com", ["mail.example.com"], fakeResolver(zone), { fetch: f })).findings.map((x) => x.code)).toEqual(["MTA_STS_POLICY_INVALID"]);
    const noId = fakeResolver({ "_mta-sts.example.com": { TXT: ["v=STSv1;"] } });
    expect((await checkMtaSts("example.com", [], noId, { http: false })).findings.map((x) => x.code)).toEqual(["MTA_STS_NO_ID"]);
    const two = fakeResolver({ "_mta-sts.example.com": { TXT: ["v=STSv1; id=1", "v=STSv1; id=2"] } });
    expect((await checkMtaSts("example.com", [], two)).findings.map((x) => x.code)).toEqual(["MTA_STS_MULTIPLE"]);
  });

  it("only mentions a missing policy for domains that receive mail, and makes no request then", async () => {
    const { f, calls } = policyFetch({ status: 200, body: POLICY });
    expect((await checkMtaSts("example.com", ["mail.example.com"], fakeResolver({}), { fetch: f })).findings.map((x) => x.code)).toEqual(["MTA_STS_MISSING"]);
    expect((await checkMtaSts("example.com", [], fakeResolver({}), { fetch: f })).findings).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("TLS-RPT", () => {
  it("is expected once MTA-STS is used, and needs a mailto: or https: rua", async () => {
    expect((await checkTlsRpt("example.com", fakeResolver({}), true)).findings.map((x) => x.code)).toEqual(["TLSRPT_MISSING"]);
    expect((await checkTlsRpt("example.com", fakeResolver({}), false)).findings).toEqual([]);
    const ok = fakeResolver({ "_smtp._tls.example.com": { TXT: ["v=TLSRPTv1; rua=mailto:tls@example.com"] } });
    expect(await checkTlsRpt("example.com", ok, true)).toMatchObject({ findings: [] });
    const bad = fakeResolver({ "_smtp._tls.example.com": { TXT: ["v=TLSRPTv1; rua=tls@example.com"] } });
    expect((await checkTlsRpt("example.com", bad, true)).findings.map((x) => x.code)).toEqual(["TLSRPT_INVALID"]);
  });
});

// ── enumerateDomain ───────────────────────────────────────────────────────────

describe("enumerateDomain email checks", () => {
  const SOA = { nsname: "ns", hostmaster: "h", serial: 1, refresh: 1, retry: 1, expire: 1, minttl: 1 };

  it("rates a missing SPF high when the domain receives mail, medium otherwise", async () => {
    const withMx = fakeResolver({
      "example.com": { SOA, NS: ["a", "b"], MX: [{ priority: 1, exchange: "smtp.google.com" }] },
      "smtp.google.com": { A: ["142.250.1.1"] },
      "_dmarc.example.com": { TXT: ["v=DMARC1; p=reject; rua=mailto:d@example.com"] },
      "google._domainkey.example.com": { TXT: [`v=DKIM1; k=rsa; p=${RSA_2048}`] },
    });
    const a = await enumerateDomain("example.com", { resolver: withMx, http: false, nsProbe: false });
    expect(a.findings.find((f) => f.code === "SPF_MISSING")!.severity).toBe("high");
    expect(a.dkimKeys).toEqual([expect.objectContaining({ selector: "google", bits: 2048 })]);

    const noMx = fakeResolver({ "example.org": { SOA, NS: ["a", "b"] } });
    const b = await enumerateDomain("example.org", { resolver: noMx, http: false, nsProbe: false });
    const spf = b.findings.find((f) => f.code === "SPF_MISSING")!;
    expect(spf.severity).toBe("medium");
    expect(spf.message).toContain("v=spf1 -all");
    expect(b.findings.map((f) => f.code)).not.toContain("DKIM_NOT_FOUND"); // no mail, no SPF: DKIM is moot
  });
});

describe("suggestSpf", () => {
  it("suggests the provider include for Google and Microsoft 365 MX hosts", () => {
    expect(suggestSpf(["smtp.google.com"])).toBe("v=spf1 include:_spf.google.com ~all");
    expect(suggestSpf(["aspmx.l.google.com", "alt1.aspmx.l.google.com"])).toBe("v=spf1 include:_spf.google.com ~all");
    expect(suggestSpf(["example-com.mail.protection.outlook.com"])).toBe("v=spf1 include:spf.protection.outlook.com ~all");
    expect(suggestSpf(["mx.unknown-host.net"])).toBe("v=spf1 include:<your-mail-provider> ~all");
    expect(suggestSpf([])).toBe("v=spf1 -all");
    expect(suggestSpf(["evilgoogle.com"])).toBe("v=spf1 include:<your-mail-provider> ~all");
  });
});
