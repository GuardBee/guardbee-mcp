import { describe, it, expect } from "vitest";
import { checkNameservers } from "../nameservers.js";
import { encodeQuery, decodeMessage, readName, soaFields, TYPE, type DnsTransport } from "../wire.js";
import { enumerateDomain } from "../dns.js";
import type { DnsResolver } from "../resolver.js";

// ── DNS message builder for fake servers ──────────────────────────────────────

function name(n: string): Buffer {
  return Buffer.concat([...n.split(".").filter(Boolean).map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
}

function soaRdata(mname: string, serial: number): Buffer {
  const nums = Buffer.alloc(20);
  nums.writeUInt32BE(serial, 0);
  return Buffer.concat([name(mname), name("hostmaster.example.com"), nums]);
}

function rr(owner: string, type: number, rdata: Buffer): Buffer {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(1, 2);
  head.writeUInt32BE(300, 4);
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([name(owner), head, rdata]);
}

function response(query: Buffer, opts: { aa?: boolean; ra?: boolean; rcode?: number; answers?: Buffer[] }): Buffer {
  const q = decodeMessage(Buffer.concat([query.subarray(0, 4), Buffer.from([0, 1, 0, 0, 0, 0, 0, 0]), query.subarray(12)]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(q.id, 0);
  header.writeUInt16BE(0x8000 | (opts.aa ? 0x0400 : 0) | (opts.ra ? 0x0080 : 0) | (opts.rcode ?? 0), 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(opts.answers?.length ?? 0, 6);
  return Buffer.concat([header, query.subarray(12), ...(opts.answers ?? [])]);
}

function questionOf(query: Buffer): { qname: string; qtype: number; rd: boolean } {
  const { name: qname, next } = readName(query, 12);
  return { qname, qtype: query.readUInt16BE(next), rd: (query.readUInt16BE(2) & 0x0100) !== 0 };
}

interface FakeServer {
  serves?: boolean | "no-aa"; // authoritative for the zone; "no-aa": answers SOA without AA (a forwarder)
  mname?: string;
  serial?: number;
  axfr?: "allow" | "refuse" | "close" | "empty";
  open?: boolean | "empty"; // answers recursive queries; "empty": NOERROR without data or RA
  down?: boolean;
}

function fakeTransport(servers: Record<string, FakeServer>): DnsTransport & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async udp(ip, query) {
      const s = servers[ip]!;
      const { qname, qtype, rd } = questionOf(query);
      log.push(`udp ${ip} ${qname} ${qtype}${rd ? " rd" : ""}`);
      if (s.down) throw new Error("timeout");
      if (qtype === TYPE.SOA) {
        return s.serves
          ? response(query, { aa: s.serves === true, answers: [rr(qname, TYPE.SOA, soaRdata(s.mname ?? "ns1.example.com", s.serial ?? 1))] })
          : response(query, { rcode: 5 });
      }
      if (rd && s.open === "empty") return response(query, {});
      if (rd && s.open) return response(query, { ra: true, answers: [rr(qname, TYPE.A, Buffer.from([8, 8, 8, 8]))] });
      return response(query, { rcode: 5 });
    },
    async tcp(ip, query) {
      const s = servers[ip]!;
      log.push(`tcp ${ip} ${questionOf(query).qtype}`);
      if (s.down || s.axfr === "close") throw new Error("connection closed");
      if (s.axfr === "empty") return [response(query, {})];
      if (s.axfr === "allow") {
        const { qname } = questionOf(query);
        return [response(query, { aa: true, answers: [rr(qname, TYPE.SOA, soaRdata("ns1.example.com", 1)), rr(`www.${qname}`, TYPE.A, Buffer.from([10, 0, 0, 1]))] })];
      }
      return [response(query, { rcode: 5 })];
    },
  };
}

function resolverFor(ips: Record<string, string>): DnsResolver {
  return {
    resolve4: (async (h: string) => {
      if (!ips[h]) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return [{ address: ips[h]!, ttl: 60 }];
    }) as unknown as DnsResolver["resolve4"],
  } as DnsResolver;
}

const codes = (fs: Array<{ code: string }>) => fs.map((f) => f.code);

// ── Wire format ───────────────────────────────────────────────────────────────

describe("wire format", () => {
  it("round-trips a query and reads compressed names and SOA fields", () => {
    const q = encodeQuery("Example.com.", TYPE.SOA, { id: 0x1234, recursion: true });
    expect(questionOf(q)).toEqual({ qname: "Example.com", qtype: TYPE.SOA, rd: true });
    // An answer whose owner is a compression pointer to the question name (offset 12).
    const ans = Buffer.concat([Buffer.from([0xc0, 12]), rr("x", TYPE.SOA, soaRdata("ns.example.com", 42)).subarray(3)]);
    const msg = decodeMessage(response(q, { aa: true, answers: [ans] }));
    expect(msg).toMatchObject({ id: 0x1234, aa: true, ra: false, rcode: 0 });
    expect(msg.answers[0]!.name).toBe("Example.com");
    expect(soaFields(msg, msg.answers[0]!)).toEqual({ mname: "ns.example.com", serial: 42 });
  });

  it("follows compression pointers beyond the first 255 bytes", () => {
    const target = Buffer.concat([Buffer.alloc(300), name("far.example.com")]);
    const withPtr = Buffer.concat([target, Buffer.from([0xc1, 0x2c])]); // 0x012c = 300
    expect(readName(withPtr, target.length)).toEqual({ name: "far.example.com", next: target.length + 2 });
  });

  it("rejects compression loops instead of hanging", () => {
    const buf = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 12])]);
    expect(() => readName(buf, 12)).toThrow(/loop/);
  });
});

// ── checkNameservers ──────────────────────────────────────────────────────────

describe("checkNameservers", () => {
  const ips = { "ns1.example.com": "192.0.2.1", "ns2.example.com": "192.0.2.2" };

  it("healthy pair: authoritative, same serial, AXFR refused, no recursion", async () => {
    const t = fakeTransport({ "192.0.2.1": { serves: true, serial: 7 }, "192.0.2.2": { serves: true, serial: 7 } });
    const rep = await checkNameservers("example.com", ["ns1.example.com", "NS2.example.com."], resolverFor(ips), { transport: t });
    expect(rep.findings).toEqual([]);
    expect(rep.servers.map((s) => [s.host, s.authoritative, s.serial, s.axfr, s.openResolver])).toEqual([
      ["ns1.example.com", true, 7, "refused", false],
      ["ns2.example.com", true, 7, "refused", false],
    ]);
    // SOA without recursion, AXFR over TCP, a recursive probe for a foreign name
    expect(t.log.filter((l) => l.includes("192.0.2.1"))).toEqual([
      "udp 192.0.2.1 example.com 6",
      "tcp 192.0.2.1 252",
      "udp 192.0.2.1 dns.google 1 rd",
    ]);
  });

  it("flags an anonymous zone transfer", async () => {
    const t = fakeTransport({ "192.0.2.1": { serves: true, axfr: "allow" }, "192.0.2.2": { serves: true, axfr: "close" } });
    const rep = await checkNameservers("example.com", Object.keys(ips), resolverFor(ips), { transport: t });
    expect(codes(rep.findings)).toEqual(["NS_AXFR_ALLOWED"]);
    expect(rep.servers.map((s) => s.axfr)).toEqual(["allowed", "unreachable"]);
  });

  it("flags lame delegation, an unreachable server, and a name that does not resolve", async () => {
    const t = fakeTransport({ "192.0.2.1": { serves: false }, "192.0.2.2": { down: true } });
    const rep = await checkNameservers("example.com", [...Object.keys(ips), "ghost.example.net"], resolverFor(ips), { transport: t });
    expect(codes(rep.findings)).toEqual(["NS_LAME", "NS_LAME", "NS_UNRESOLVABLE"]);
    expect(rep.findings[0]!.message).toContain("REFUSED");
    expect(rep.findings[1]!.message).toContain("no answer");
  });

  it("a server answering SOA without the AA flag is lame (a forwarder, not the zone's server)", async () => {
    const t = fakeTransport({ "192.0.2.1": { serves: "no-aa" }, "192.0.2.2": { serves: true } });
    const rep = await checkNameservers("example.com", Object.keys(ips), resolverFor(ips), { transport: t });
    expect(codes(rep.findings)).toEqual(["NS_LAME"]);
    expect(rep.findings[0]!.message).toContain("no AA");
  });

  it("an empty NOERROR to AXFR or to a recursive query is not a finding", async () => {
    const t = fakeTransport({ "192.0.2.1": { serves: true, axfr: "empty", open: "empty" }, "192.0.2.2": { serves: true } });
    const rep = await checkNameservers("example.com", Object.keys(ips), resolverFor(ips), { transport: t });
    expect(rep.findings).toEqual([]);
    expect(rep.servers[0]).toMatchObject({ axfr: "refused", openResolver: false });
  });

  it("flags an open resolver", async () => {
    const t = fakeTransport({ "192.0.2.1": { serves: true, open: true }, "192.0.2.2": { serves: true } });
    const rep = await checkNameservers("example.com", Object.keys(ips), resolverFor(ips), { transport: t });
    expect(codes(rep.findings)).toEqual(["NS_OPEN_RESOLVER"]);
  });

  it("compares serials only between servers of the same primary", async () => {
    const drift = fakeTransport({ "192.0.2.1": { serves: true, serial: 7 }, "192.0.2.2": { serves: true, serial: 6 } });
    expect(codes((await checkNameservers("example.com", Object.keys(ips), resolverFor(ips), { transport: drift })).findings)).toEqual(["NS_SOA_SERIAL_MISMATCH"]);
    const multiProvider = fakeTransport({
      "192.0.2.1": { serves: true, serial: 1656468023, mname: "dns1.p08.nsone.net" },
      "192.0.2.2": { serves: true, serial: 1, mname: "ns-421.awsdns-52.com" },
    });
    expect((await checkNameservers("example.com", Object.keys(ips), resolverFor(ips), { transport: multiProvider })).findings).toEqual([]);
  });
});

describe("enumerateDomain with nameserver probes", () => {
  it("sets zoneTransferVulnerable from the probes and skips them with nsProbe: false", async () => {
    const SOA = { nsname: "ns1.example.com", hostmaster: "h", serial: 1, refresh: 1, retry: 1, expire: 1, minttl: 1 };
    const err = (code: string) => Object.assign(new Error(code), { code });
    const zone: Record<string, Record<string, unknown>> = {
      "example.com": { SOA, NS: ["ns1.example.com", "ns2.example.com"] },
      "ns1.example.com": { A: [{ address: "192.0.2.1", ttl: 60 }] },
      "ns2.example.com": { A: [{ address: "192.0.2.2", ttl: 60 }] },
    };
    const get = (type: string) => async (n: string) => {
      const e = zone[n];
      if (!e) throw err("ENOTFOUND");
      if (!e[type]) throw err("ENODATA");
      return e[type];
    };
    const r = {
      resolve4: get("A"), resolve6: get("AAAA"), resolveMx: get("MX"), resolveNs: get("NS"),
      resolveTxt: get("TXT"), resolveCname: get("CNAME"), resolveSoa: get("SOA"),
    } as unknown as DnsResolver;
    const t = fakeTransport({ "192.0.2.1": { serves: true, axfr: "allow" }, "192.0.2.2": { serves: true } });

    const probed = await enumerateDomain("example.com", { resolver: r, http: false, dnsTransport: t });
    expect(probed.zoneTransferVulnerable).toBe(true);
    expect(probed.findings.map((f) => f.code)).toContain("NS_AXFR_ALLOWED");

    t.log.length = 0;
    const skipped = await enumerateDomain("example.com", { resolver: r, http: false, nsProbe: false, dnsTransport: t });
    expect(skipped.zoneTransferVulnerable).toBeUndefined();
    expect(t.log).toEqual([]);
  });
});
