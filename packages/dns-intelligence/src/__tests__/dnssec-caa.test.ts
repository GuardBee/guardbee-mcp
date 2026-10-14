import { describe, it, expect } from "vitest";
import { checkDnssec } from "../dnssec.js";
import { checkCaa, findCaa, type CaaRecord } from "../caa.js";

// ── Fake DNS-over-HTTPS (shapes copied from dns.google answers) ───────────────

type Answer = { Status: number; AD?: boolean; Answer?: Array<{ name: string; type: number; data: string }> };

/** responses["name TYPE cd"] → answer; anything else is NOERROR, empty. */
function fakeDoh(responses: Record<string, Answer | "DOWN">) {
  const calls: string[] = [];
  const f = (async (input: string | URL) => {
    const u = new URL(String(input));
    const key = `${u.searchParams.get("name")} ${u.searchParams.get("type")} ${u.searchParams.get("cd") === "true" ? "cd" : "-"}`;
    calls.push(key);
    const r = responses[key];
    if (r === "DOWN") throw new TypeError("fetch failed");
    return Response.json(r ?? { Status: 0 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const SOA = (name: string) => ({ name: `${name}.`, type: 6, data: "ns. host. 1 1 1 1 1" });

describe("checkDnssec", () => {
  it("signed zone: validated, with algorithm and DS digest", async () => {
    const { f } = fakeDoh({
      "example.com SOA -": { Status: 0, AD: true, Answer: [SOA("example.com")] },
      "example.com DS -": { Status: 0, AD: true, Answer: [{ name: "example.com.", type: 43, data: "2371 13 2 ABCD" }] },
      "example.com DNSKEY cd": { Status: 0, Answer: [{ name: "example.com.", type: 48, data: "257 3 13 key==" }] },
    });
    expect(await checkDnssec("example.com", { fetch: f })).toEqual({
      status: "signed",
      algorithms: ["ECDSAP256SHA256"],
      dsDigests: ["SHA-256"],
      findings: [],
    });
  });

  it("broken chain: SERVFAIL when validating, answers with checking disabled", async () => {
    const { f } = fakeDoh({
      "bad.example SOA -": { Status: 2 },
      "bad.example SOA cd": { Status: 0, Answer: [SOA("bad.example")] },
    });
    const res = await checkDnssec("bad.example", { fetch: f });
    expect(res.status).toBe("broken");
    expect(res.findings.map((x) => [x.code, x.severity])).toEqual([["DNSSEC_BROKEN", "critical"]]);
  });

  it("SERVFAIL either way is a server failure, not a DNSSEC verdict", async () => {
    const { f } = fakeDoh({ "down.example SOA -": { Status: 2 }, "down.example SOA cd": { Status: 2 } });
    expect(await checkDnssec("down.example", { fetch: f })).toMatchObject({ status: "unchecked", findings: [] });
  });

  it("unsigned zone apex gets a low finding; a CNAME'd host does not repeat it", async () => {
    const { f } = fakeDoh({
      "example.com SOA -": { Status: 0, Answer: [SOA("example.com")] },
      "www.example.com SOA -": {
        Status: 0,
        Answer: [{ name: "www.example.com.", type: 5, data: "example.com." }, SOA("example.com")],
      },
    });
    expect((await checkDnssec("example.com", { fetch: f })).findings.map((x) => x.code)).toEqual(["DNSSEC_DISABLED"]);
    expect(await checkDnssec("www.example.com", { fetch: f })).toMatchObject({ status: "unsigned", findings: [] });
  });

  it("DNSKEY without DS is partial; deprecated algorithms and SHA-1-only DS are flagged", async () => {
    const noDs = fakeDoh({
      "example.com SOA -": { Status: 0, Answer: [SOA("example.com")] },
      "example.com DNSKEY cd": { Status: 0, Answer: [{ name: "example.com.", type: 48, data: "257 3 8 k" }] },
    });
    const a = await checkDnssec("example.com", { fetch: noDs.f });
    expect(a.status).toBe("partial");
    expect(a.findings.map((x) => x.code)).toEqual(["DNSSEC_NO_DS"]);

    const old = fakeDoh({
      "example.com SOA -": { Status: 0, AD: true, Answer: [SOA("example.com")] },
      "example.com DS -": { Status: 0, Answer: [{ name: "example.com.", type: 43, data: "1 5 1 AB" }] },
      "example.com DNSKEY cd": { Status: 0, Answer: [{ name: "example.com.", type: 48, data: "257 3 5 k" }] },
    });
    const b = await checkDnssec("example.com", { fetch: old.f });
    expect(b.status).toBe("signed");
    expect(b.findings.map((x) => x.code)).toEqual(["DNSSEC_WEAK_ALGORITHM", "DNSSEC_DS_SHA1"]);
  });

  it("a DS without a validated answer is partial, not signed", async () => {
    const { f } = fakeDoh({
      "example.com SOA -": { Status: 0, AD: false, Answer: [SOA("example.com")] },
      "example.com DS -": { Status: 0, Answer: [{ name: "example.com.", type: 43, data: "2371 13 2 AB" }] },
      "example.com DNSKEY cd": { Status: 0, Answer: [{ name: "example.com.", type: 48, data: "257 3 13 k" }] },
    });
    expect((await checkDnssec("example.com", { fetch: f })).status).toBe("partial");
  });

  it("reports unchecked when DoH is unavailable", async () => {
    const { f } = fakeDoh({ "example.com SOA -": "DOWN" });
    expect(await checkDnssec("example.com", { fetch: f })).toMatchObject({ status: "unchecked", findings: [] });
  });
});

// ── CAA ───────────────────────────────────────────────────────────────────────

function caaZone(zone: Record<string, CaaRecord[]>) {
  const asked: string[] = [];
  const resolve = async (name: string) => {
    asked.push(name);
    if (!zone[name]) throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
    return zone[name]!;
  };
  return { resolve, asked };
}

describe("CAA", () => {
  it("climbs to the nearest ancestor with CAA, but not to the TLD", async () => {
    const z = caaZone({ "example.com": [{ critical: 0, issue: "letsencrypt.org" }] });
    expect(await findCaa("a.b.example.com", z.resolve)).toMatchObject({ at: "example.com" });
    expect(z.asked).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
    const none = caaZone({});
    expect(await findCaa("example.com", none.resolve)).toEqual({ records: [] });
    expect(none.asked).toEqual(["example.com"]);
  });

  it("missing CAA is low", async () => {
    const res = await checkCaa("example.com", { resolveCaa: caaZone({}).resolve, issuer: async () => "Let's Encrypt" });
    expect(res.findings.map((x) => [x.code, x.severity])).toEqual([["CAA_MISSING", "low"]]);
  });

  it("flags CAA that would block the current certificate's CA from renewing", async () => {
    const z = caaZone({ "example.com": [{ critical: 0, issue: "letsencrypt.org; validationmethods=dns-01" }] });
    const ok = await checkCaa("example.com", { resolveCaa: z.resolve, issuer: async () => "Let's Encrypt" });
    expect(ok).toMatchObject({ issue: ["letsencrypt.org"], currentIssuer: "Let's Encrypt", findings: [] });
    const blocked = await checkCaa("example.com", { resolveCaa: z.resolve, issuer: async () => "Google Trust Services" });
    expect(blocked.findings.map((x) => [x.code, x.severity])).toEqual([["CAA_BLOCKS_CURRENT_CA", "medium"]]);
  });

  it("does not flag when only issuewild is set, the CA is unknown, or no certificate was read", async () => {
    const wildOnly = caaZone({ "example.com": [{ critical: 0, issuewild: "letsencrypt.org" }] });
    expect((await checkCaa("example.com", { resolveCaa: wildOnly.resolve, issuer: async () => "Google Trust Services" })).findings).toEqual([]);
    const z = caaZone({ "example.com": [{ critical: 0, issue: "letsencrypt.org" }] });
    expect((await checkCaa("example.com", { resolveCaa: z.resolve, issuer: async () => "Some Private CA" })).findings).toEqual([]);
    expect((await checkCaa("example.com", { resolveCaa: z.resolve, issuer: async () => undefined })).findings).toEqual([]);
  });

  it('"issue ;" forbids every CA; a critical unknown tag blocks issuance', async () => {
    const deny = caaZone({ "example.com": [{ critical: 0, issue: ";" }] });
    const res = await checkCaa("example.com", { resolveCaa: deny.resolve, issuer: async () => "Let's Encrypt" });
    expect(res.issue).toEqual([""]);
    expect(res.findings[0]!.message).toContain("only allows no CA");
    const crit = caaZone({ "example.com": [{ critical: 128, tbs: "x" } as CaaRecord, { critical: 0, issue: "letsencrypt.org" }] });
    const c = await checkCaa("example.com", { resolveCaa: crit.resolve, issuer: async () => "Let's Encrypt" });
    expect(c.findings.map((x) => x.code)).toEqual(["CAA_UNKNOWN_CRITICAL"]);
  });
});
