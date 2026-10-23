import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EgressBlockedError, classifyAddress, guardedFetch, hostAllowed, type EgressPolicy, type Resolver } from "../network.js";

const hostOf = (url: string) => new URL(url).hostname.replace(/^\[|\]$/g, "");

describe("classifyAddress", () => {
  it.each([
    ["8.8.8.8", "public"],
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.31.255.1", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["100.64.0.1", "private"],
    ["169.254.169.254", "link-local"],
    ["0.0.0.0", "unspecified"],
    ["255.255.255.255", "reserved"],
    ["224.0.0.1", "reserved"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link-local"],
    ["fd00:ec2::254", "link-local"],
    ["fd12:3456::1", "private"],
    ["2606:4700::1111", "public"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:a9fe:a9fe", "link-local"],
    ["64:ff9b::a00:1", "private"],
    ["2002:7f00:1::", "loopback"],
  ])("%s → %s", (ip, expected) => {
    expect(classifyAddress(ip)).toBe(expected);
  });

  it.each([
    ["http://0x7f.0.0.1/", "loopback"],
    ["http://2130706433/", "loopback"],
    ["http://017700000001/", "loopback"],
    ["http://0251.0376.0251.0376/", "link-local"],
    ["http://[::ffff:169.254.169.254]/", "link-local"],
    ["http://[0:0:0:0:0:ffff:7f00:1]/", "loopback"],
  ])("judges the encoded form %s by the address it means (%s)", (url, expected) => {
    expect(classifyAddress(hostOf(url))).toBe(expected);
  });
});

describe("hostAllowed", () => {
  it("matches exact names and subdomain globs, case and trailing dot aside", () => {
    expect(hostAllowed("API.Example.com.", ["api.example.com"])).toBe(true);
    expect(hostAllowed("a.b.example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["*.example.com"])).toBe(false);
    expect(hostAllowed("example.com.evil.net", ["*.example.com"])).toBe(false);
    expect(hostAllowed("[::1]", ["::1"])).toBe(true);
  });
});

describe("guardedFetch", () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(307, { location: "http://169.254.169.254/latest/meta-data/" }).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => res.writeHead(200, { "content-type": "text/plain", "x-seen": req.headers["x-test"] ?? "" }).end(`${req.method} ${body}`));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const open: EgressPolicy = { mode: "open", blockPrivate: false };
  const strict: EgressPolicy = { mode: "open", blockPrivate: true };
  /** Every name resolves to 127.0.0.1, as a rebinding DNS server would answer for a "public" name. */
  const toLoopback: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];

  it("sends method, headers and body when the address is allowed", async () => {
    const response = await guardedFetch(open)(`http://127.0.0.1:${port}/x`, { method: "POST", headers: { "x-test": "1" }, body: "hello" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-seen")).toBe("1");
    expect(await response.text()).toBe("POST hello");
  });

  it("refuses a private literal address under blockPrivate, and reports it", async () => {
    const blocked: EgressBlockedError[] = [];
    const error = await guardedFetch(strict, { onBlocked: (e) => blocked.push(e) })(`http://127.0.0.1:${port}/`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EgressBlockedError);
    expect(blocked.map((e) => [e.rule, e.address])).toEqual([["network:private", "127.0.0.1"]]);
  });

  it("refuses cloud metadata even when private addresses are allowed", async () => {
    const error = await guardedFetch(open)("http://169.254.169.254/latest/meta-data/").catch((e: unknown) => e);
    expect((error as EgressBlockedError).rule).toBe("network:metadata");
  });

  it("checks the address a name resolves to at connect time (DNS rebinding)", async () => {
    let calls = 0;
    // First answer public, then private: the connect sees the second answer and is refused
    const rebinding: Resolver = async () => (calls++ === 0 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
    const policy: EgressPolicy = { mode: "allowlist", allowHosts: ["rebind.example"], blockPrivate: true };
    await rebinding("rebind.example"); // the "check" a naive guard would do
    const error = await guardedFetch(policy, { resolve: rebinding })(`http://rebind.example:${port}/`).catch((e: unknown) => e);
    expect((error as EgressBlockedError).rule).toBe("network:private");
  });

  it("refuses a name that answers with both a public and a private address", async () => {
    const mixed: Resolver = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
    const error = await guardedFetch(strict, { resolve: mixed })(`http://mixed.example:${port}/`).catch((e: unknown) => e);
    expect((error as EgressBlockedError).address).toBe("10.0.0.5");
  });

  it("connects to the checked address when the name is allowed", async () => {
    const policy: EgressPolicy = { mode: "allowlist", allowHosts: ["*.internal.test"], blockPrivate: false };
    const response = await guardedFetch(policy, { resolve: toLoopback })(`http://mcp.internal.test:${port}/`);
    expect(await response.text()).toBe("GET ");
  });

  it("refuses a host outside allowHosts before resolving it", async () => {
    let resolved = false;
    const policy: EgressPolicy = { mode: "allowlist", allowHosts: ["api.example.com"], blockPrivate: true };
    const error = await guardedFetch(policy, { resolve: async () => ((resolved = true), []) })("https://other.example.com/").catch((e: unknown) => e);
    expect((error as EgressBlockedError).rule).toBe("network:host");
    expect(resolved).toBe(false);
  });

  it("returns a redirect unfollowed, so its target is checked on the next request", async () => {
    const fetch = guardedFetch(open);
    const response = await fetch(`http://127.0.0.1:${port}/redirect`);
    expect(response.status).toBe(307);
    const error = await fetch(response.headers.get("location")!).catch((e: unknown) => e);
    expect((error as EgressBlockedError).rule).toBe("network:metadata");
  });

  it("allows nothing in mode none", async () => {
    const error = await guardedFetch({ mode: "none", blockPrivate: true })(`http://127.0.0.1:${port}/`).catch((e: unknown) => e);
    expect((error as EgressBlockedError).rule).toBe("network:none");
  });
});
